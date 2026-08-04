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
