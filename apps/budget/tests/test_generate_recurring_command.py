"""
Tests for the generate_recurring_instances command's failure handling.

This is the entry point for the app's core automation and runs unattended at 04:30. It had
no per-item guard, so one unusable schedule aborted the whole run — including every schedule
queued behind it — leaving a traceback in a log nobody reads and silently skipping the rest.
"""

import datetime
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError

from apps.base.tests import BaseTest
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    RecurringTransaction,
    Transaction,
)


class TestGenerateRecurringInstances(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.cat = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)

    def _recurring(self, name):
        return RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.cat,
            created_by=self.user,
            name=name,
            amount=Decimal("10.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=datetime.date(2026, 1, 1),
        )

    def test_generates_instances(self):
        self._recurring("Netflix")
        call_command("generate_recurring_instances", stdout=StringIO())
        self.assertGreater(Transaction.objects.count(), 0)

    def test_one_failing_schedule_does_not_stop_the_others(self):
        bad = self._recurring("Broken")
        good = self._recurring("Fine")
        real = RecurringTransaction.generate_instances_up_to

        def selective(self, through_date):
            if self.pk == bad.pk:
                raise ValueError("simulated bad row")
            return real(self, through_date)

        with (
            mock.patch.object(RecurringTransaction, "generate_instances_up_to", selective),
            self.assertRaises(CommandError),
        ):
            call_command("generate_recurring_instances", stdout=StringIO(), stderr=StringIO())

        # The healthy schedule must still have been generated despite the earlier failure.
        self.assertGreater(Transaction.objects.filter(recurring=good).count(), 0)
        self.assertEqual(Transaction.objects.filter(recurring=bad).count(), 0)

    def test_failure_names_the_offending_schedule_on_stderr(self):
        bad = self._recurring("Broken")
        err = StringIO()
        with (
            mock.patch.object(
                RecurringTransaction, "generate_instances_up_to", side_effect=ValueError("simulated bad row")
            ),
            self.assertRaises(CommandError),
        ):
            call_command("generate_recurring_instances", stdout=StringIO(), stderr=err)
        output = err.getvalue()
        self.assertIn(str(bad.pk), output)
        self.assertIn("Broken", output)
        self.assertIn("simulated bad row", output)

    def test_clean_run_does_not_raise(self):
        self._recurring("Netflix")
        call_command("generate_recurring_instances", stdout=StringIO(), stderr=StringIO())


class TestLookaheadWindow(TestGenerateRecurringInstances):
    """
    The window is days, not months.

    A month-based lookahead materialized every bill for the next three months on the 1st, so
    the register opened the month with dozens of rows that could not be reconciled until it
    ended. Nothing pinned the width, so these tests exist to keep it narrow.
    """

    def test_generates_only_within_the_lookahead_window(self):
        self._recurring("Netflix")
        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", stdout=StringIO())

        due = sorted(Transaction.objects.values_list("due_date", flat=True))
        self.assertTrue(due, "expected at least one instance inside the window")
        self.assertLessEqual(due[-1], datetime.date(2026, 8, 7), f"generated past the 3-day window: {due}")

    def test_window_width_follows_the_setting(self):
        self._recurring("Netflix")
        with (
            mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)),
            self.settings(BUDGET_RECURRING_LOOKAHEAD_DAYS=40),
        ):
            call_command("generate_recurring_instances", stdout=StringIO())

        # Widening reaches September's instance; the 3-day default would not.
        self.assertTrue(Transaction.objects.filter(due_date=datetime.date(2026, 9, 1)).exists())

    def test_a_bill_appears_three_days_before_it_is_due_not_a_month_early(self):
        """The whole point of the change: mid-August, September's rent is not in the register yet."""
        self._recurring("Rent")  # monthly, due the 1st
        sep_1 = datetime.date(2026, 9, 1)

        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", stdout=StringIO())
        self.assertFalse(
            Transaction.objects.filter(due_date=sep_1).exists(),
            "September's bill was materialized four weeks ahead of its due date",
        )

        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 30)):
            call_command("generate_recurring_instances", stdout=StringIO())
        self.assertTrue(Transaction.objects.filter(due_date=sep_1).exists(), "it never arrived inside the window")


class TestPrune(TestGenerateRecurringInstances):
    """
    --prune cleans up after the window is narrowed.

    Narrowing alone is not enough: the old instances remain, and each schedule's watermark is
    already parked past the new window, so the generator computes an empty date list and the
    nightly run silently does nothing until the calendar catches up.
    """

    def _widely_generated(self):
        rt = self._recurring("Netflix")
        with (
            self.settings(BUDGET_RECURRING_LOOKAHEAD_DAYS=120),
            mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)),
        ):
            call_command("generate_recurring_instances", stdout=StringIO())
        rt.refresh_from_db()
        return rt

    def test_prune_removes_instances_past_the_window_and_rewinds_the_watermark(self):
        rt = self._widely_generated()
        self.assertGreater(Transaction.objects.filter(due_date__gt=datetime.date(2026, 8, 7)).count(), 0)

        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", "--prune", stdout=StringIO())

        rt.refresh_from_db()
        self.assertEqual(Transaction.objects.filter(due_date__gt=datetime.date(2026, 8, 7)).count(), 0)
        self.assertEqual(rt.generated_through, datetime.date(2026, 8, 7))

    def test_prune_keeps_paid_history(self):
        self._widely_generated()
        future = Transaction.objects.filter(due_date__gt=datetime.date(2026, 8, 7)).order_by("due_date").first()
        future.paid_date = future.due_date
        future.save(update_fields=["paid_date"])

        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", "--prune", stdout=StringIO())

        self.assertTrue(Transaction.objects.filter(pk=future.pk).exists(), "a paid instance was pruned")

    def test_pruning_then_running_daily_resumes_generation(self):
        """Without the rewind the watermark sits past the window and nothing regenerates."""
        self._widely_generated()
        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", "--prune", stdout=StringIO())
        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 9, 1)):
            call_command("generate_recurring_instances", stdout=StringIO())

        self.assertTrue(
            Transaction.objects.filter(due_date=datetime.date(2026, 9, 1)).exists(),
            "September's instance never came back after the prune",
        )

    def test_prune_is_off_by_default(self):
        self._widely_generated()
        with mock.patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 8, 4)):
            call_command("generate_recurring_instances", stdout=StringIO())
        self.assertGreater(Transaction.objects.filter(due_date__gt=datetime.date(2026, 8, 7)).count(), 0)
