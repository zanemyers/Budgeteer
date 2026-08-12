"""
Regression tests for the correctness fixes in apps/budget/views.py and config/urls.py.

Each class here pins a specific bug that was found and fixed; the docstrings name the
behaviour that used to be wrong so a future refactor can't quietly reintroduce it.
"""

import datetime
import json
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone

from apps.base.models import Currency
from apps.base.tests import BaseTest
from apps.budget.data import get_goal_total_saved
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    CategoryBudget,
    Goal,
    PaySchedule,
    RecurringTransaction,
    Transaction,
    TransactionLine,
)


class TestProjectFilesAreNotServed(BaseTest):
    """
    Project source files must not be reachable over HTTP.

    An unset MEDIA_URL resolved to "/", which turned the static() helper in config/urls.py
    into a catch-all serving the whole project root — .env included — and shadowed the
    custom 404 handler.
    """

    def test_dotenv_is_not_served(self):
        self.assertEqual(self.client.get("/.env").status_code, 404)

    def test_source_files_are_not_served(self):
        for path in ("/pyproject.toml", "/uv.lock", "/manage.py", "/config/settings/_base.py"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)


class BudgetViewTestCase(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.expense_cat = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)

    def _patch_json(self, url, payload):
        return self.client.patch(url, data=json.dumps(payload), content_type="application/json")


class TestMarkPaidUsesLocalDate(BudgetViewTestCase):
    """
    Marking paid must stamp the local date, not the container's UTC date.

    paid_date came from naive datetime.date.today(), i.e. the container's UTC clock. Late
    evening in America/Chicago that is already tomorrow, so a transaction marked paid on the
    last evening of a month was filed into the next budget month.
    """

    def test_paid_date_is_local_not_utc(self):
        txn = Transaction.objects.create(budget=self.budget, description="Rent", due_date=datetime.date(2026, 1, 31))
        TransactionLine.objects.create(
            transaction=txn, category=self.expense_cat, amount=Decimal("10.00"), amount_usd=Decimal("10.00")
        )
        # 2026-02-01 04:30 UTC is 2026-01-31 22:30 in America/Chicago.
        instant = datetime.datetime(2026, 2, 1, 4, 30, tzinfo=datetime.UTC)
        self.client.force_login(self.user)
        url = reverse("budget:transaction-mark-paid", kwargs={"budget_pk": self.budget.pk, "pk": txn.pk})
        with mock.patch("django.utils.timezone.now", return_value=instant):
            self.assertEqual(timezone.localdate(), datetime.date(2026, 1, 31))
            self.client.post(url)
        txn.refresh_from_db()
        self.assertEqual(txn.paid_date, datetime.date(2026, 1, 31))


class TestGoalBalanceCurrency(BudgetViewTestCase):
    """
    Goal balance transactions must record currency and a converted amount_usd.

    Goal opening balances and balance adjustments were written with no currency and an
    unconverted amount_usd, so for a non-USD user the stored USD value was the foreign
    amount and every total that reads amount_usd was wrong.
    """

    def setUp(self):
        super().setUp()
        # rate_to_usd is populated from /latest/USD, so it is units-per-USD: divide to get USD.
        Currency.objects.create(code="EUR", name="Euro", symbol="€", rate_to_usd=Decimal("0.80"))
        self.user.currency = "EUR"
        self.user.save(update_fields=["currency"])
        self.client.force_login(self.user)

    def test_opening_balance_is_converted(self):
        url = reverse("budget:category-create", kwargs={"budget_pk": self.budget.pk})
        res = self.client.post(
            url,
            data=json.dumps(
                {
                    "name": "New Roof",
                    "category_type": Category.TYPE_EXPENSE,
                    "is_goal": True,
                    "goal_target": "10000.00",
                    "goal_due_date": "2027-01-01",
                    "goal_initial_balance": "400.00",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        line = TransactionLine.objects.get(description="Opening balance")
        self.assertEqual(line.amount, Decimal("400.00"))
        # 400 EUR at 0.80 units-per-USD == 500 USD.
        self.assertEqual(line.amount_usd, Decimal("500.00"))
        self.assertEqual(line.transaction.currency, "EUR")
        self.assertEqual(line.transaction.exchange_rate_to_usd, Decimal("0.80"))

    def test_balance_adjustment_is_converted(self):
        cat = Category.objects.create(budget=self.budget, name="Car", category_type=Category.TYPE_EXPENSE)
        Goal.objects.create(category=cat, target=Decimal("5000.00"))
        url = reverse("budget:category-edit", kwargs={"budget_pk": self.budget.pk, "pk": cat.pk})
        res = self._patch_json(url, {"add_amount": "80.00"})
        self.assertEqual(res.status_code, 200)
        line = TransactionLine.objects.get(category=cat)
        self.assertEqual(line.amount, Decimal("80.00"))
        self.assertEqual(line.amount_usd, Decimal("100.00"))
        self.assertEqual(line.transaction.currency, "EUR")

    def test_settings_page_agrees_with_goals_page(self):
        """BudgetSettingsView summed raw `amount`; the Goals page sums amount_usd * rate."""
        cat = Category.objects.create(budget=self.budget, name="Trip", category_type=Category.TYPE_EXPENSE)
        Goal.objects.create(category=cat, target=Decimal("2000.00"))
        txn = Transaction.objects.create(
            budget=self.budget,
            description="funding",
            due_date=datetime.date(2026, 3, 1),
            paid_date=datetime.date(2026, 3, 1),
            transaction_type="income",
            currency="EUR",
            exchange_rate_to_usd=Decimal("0.80"),
        )
        TransactionLine.objects.create(
            transaction=txn, category=cat, amount=Decimal("160.00"), amount_usd=Decimal("200.00")
        )

        # Ask for the Inertia XHR variant so props come back as JSON rather than embedded HTML.
        res = self.client.get(
            reverse("budget:settings", kwargs={"budget_pk": self.budget.pk}),
            headers={"x-inertia": "true", "x-inertia-version": "1.0"},
        )
        self.assertEqual(res.status_code, 200)
        categories = res.json()["props"]["categories"]
        settings_value = next(Decimal(c["total_saved"]) for c in categories if c["id"] == cat.pk)
        goals_value = get_goal_total_saved(self.budget, cat.pk, Decimal("0.80"))
        self.assertEqual(settings_value, goals_value)
        # 200 USD scaled back to EUR is the 160 originally entered.
        self.assertEqual(settings_value, Decimal("160.00"))


class TestGeneratorUniqueness(BudgetViewTestCase):
    """
    Generated schedule instances must be unique per (schedule, due_date).

    Both generators use get_or_create(schedule, due_date), which is only atomic when a
    unique constraint backs the lookup. Without one, overlapping runs duplicated instances.
    """

    def test_recurring_generation_is_idempotent(self):
        cat = self.expense_cat
        rt = RecurringTransaction.objects.create(
            budget=self.budget,
            category=cat,
            created_by=self.user,
            name="Netflix",
            amount=Decimal("15.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=datetime.date(2026, 1, 1),
        )
        through = datetime.date(2026, 4, 30)
        rt.generate_instances_up_to(through)
        first = Transaction.objects.filter(recurring=rt).count()
        # Re-running from a reset watermark must not duplicate.
        rt.generated_through = None
        rt.save(update_fields=["generated_through"])
        rt.generate_instances_up_to(through)
        self.assertEqual(Transaction.objects.filter(recurring=rt).count(), first)

    def test_duplicate_recurring_instance_is_rejected_by_the_database(self):
        rt = RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.expense_cat,
            created_by=self.user,
            name="Gym",
            amount=Decimal("30.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=datetime.date(2026, 1, 1),
        )
        due = datetime.date(2026, 1, 1)
        Transaction.objects.create(budget=self.budget, description="Gym", due_date=due, recurring=rt)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Transaction.objects.create(budget=self.budget, description="Gym again", due_date=due, recurring=rt)

    def test_duplicate_pay_schedule_instance_is_rejected_by_the_database(self):
        schedule = PaySchedule.objects.create(budget=self.budget, name="Acme")
        due = datetime.date(2026, 1, 15)
        Transaction.objects.create(budget=self.budget, description="Acme", due_date=due, pay_schedule=schedule)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Transaction.objects.create(budget=self.budget, description="Acme dup", due_date=due, pay_schedule=schedule)

    def test_manual_transactions_are_not_constrained(self):
        """The constraints are partial — transactions with no schedule must be unrestricted."""
        due = datetime.date(2026, 1, 20)
        Transaction.objects.create(budget=self.budget, description="Coffee", due_date=due)
        Transaction.objects.create(budget=self.budget, description="Coffee", due_date=due)
        self.assertEqual(Transaction.objects.filter(description="Coffee").count(), 2)


class TestRecurringPatchValidation(BudgetViewTestCase):
    """
    Editing a recurring schedule must validate input instead of trusting it.

    RecurringDetailView.patch assigned request values with setattr and no validation.
    interval=0 made _advance return the same date forever, so the next generation call —
    in the request, and then nightly in cron — never terminated.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.rt = RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.expense_cat,
            created_by=self.user,
            name="Insurance",
            amount=Decimal("100.00"),
            frequency=RecurringTransaction.FREQ_EVERY_N,
            interval=6,
            start_date=datetime.date(2026, 1, 1),
        )
        self.url = reverse("budget:recurring-detail", kwargs={"budget_pk": self.budget.pk, "pk": self.rt.pk})

    def test_zero_interval_is_rejected(self):
        res = self._patch_json(self.url, {"interval": 0})
        self.assertEqual(res.status_code, 400)
        self.assertIn("interval", res.json()["errors"])
        self.rt.refresh_from_db()
        self.assertEqual(self.rt.interval, 6)

    def test_bad_frequency_is_rejected(self):
        res = self._patch_json(self.url, {"frequency": "hourly"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("frequency", res.json()["errors"])

    def test_bad_amount_is_rejected_not_a_500(self):
        res = self._patch_json(self.url, {"amount": "not-a-number"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("amount", res.json()["errors"])

    def test_bad_date_is_rejected_not_a_500(self):
        res = self._patch_json(self.url, {"start_date": "31/01/2026"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("start_date", res.json()["errors"])

    def test_advance_cannot_stall_even_with_a_bad_interval(self):
        """Last-line defence: _advance clamps to >= 1 so nothing can loop forever."""
        rt = RecurringTransaction(frequency=RecurringTransaction.FREQ_EVERY_N, interval=0)
        self.assertGreater(rt._advance(datetime.date(2026, 1, 1)), datetime.date(2026, 1, 1))

    def test_ending_a_schedule_does_not_regenerate_instances(self):
        """
        Stopping a schedule is an end date now, not an is_active flag.

        patch() deletes unpaid future instances and regenerates so schedule edits propagate.
        That must not resurrect the instances of a schedule that was just ended, which is what
        the old is_active guard was there for — the work is now done by generate_instances_up_to
        skipping occurrences past end_date.
        """
        self.rt.generate_instances_up_to(datetime.date(2026, 12, 31))
        self.assertGreater(Transaction.objects.filter(recurring=self.rt, paid_date__isnull=True).count(), 0)

        res = self._patch_json(self.url, {"end_date": timezone.localdate().isoformat()})
        self.assertEqual(res.status_code, 200)

        future = Transaction.objects.filter(
            recurring=self.rt, paid_date__isnull=True, due_date__gt=timezone.localdate()
        )
        self.assertEqual(future.count(), 0)
        self.assertIsNone(res.json()["next_due_date"], "an ended schedule should report no next due date")

    def test_clearing_the_end_date_restarts_a_stopped_schedule(self):
        """The only way back from a stop, so a null end_date has to be accepted and act on it."""
        self._patch_json(self.url, {"end_date": timezone.localdate().isoformat()})
        self.rt.refresh_from_db()
        self.assertIsNotNone(self.rt.end_date)

        res = self._patch_json(self.url, {"end_date": None})
        self.assertEqual(res.status_code, 200)
        self.rt.refresh_from_db()
        self.assertIsNone(self.rt.end_date)
        self.assertIsNotNone(res.json()["next_due_date"], "a restarted schedule should have a next due date again")

    def test_is_active_is_gone_from_the_payload(self):
        res = self._patch_json(self.url, {"name": "Insurance"})
        self.assertNotIn("is_active", res.json())


class TestRecurringDelete(BudgetViewTestCase):
    """
    Deleting a schedule must not take history with it.

    Transaction.recurring is SET_NULL, so paid instances survive as ordinary transactions —
    that property is what made it safe to drop the is_active soft-delete. Upcoming unpaid
    instances are placeholders for a schedule that will no longer exist, so they go too;
    a past-due unpaid one stays, because that is a bill still owed.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.rt = RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.expense_cat,
            created_by=self.user,
            name="Rent",
            amount=Decimal("100.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=datetime.date(2026, 1, 1),
        )
        self.url = reverse("budget:recurring-detail", kwargs={"budget_pk": self.budget.pk, "pk": self.rt.pk})

    def test_delete_keeps_paid_history_and_overdue_bills_but_drops_upcoming(self):
        today = timezone.localdate()
        self.rt.generate_instances_up_to(today + datetime.timedelta(days=400))
        instances = Transaction.objects.filter(recurring=self.rt)

        paid = instances.filter(due_date__lt=today).first()
        paid.paid_date = paid.due_date
        paid.save(update_fields=["paid_date"])
        overdue = instances.filter(due_date__lt=today, paid_date__isnull=True).exclude(pk=paid.pk).first()
        upcoming = instances.filter(due_date__gt=today).first()
        self.assertIsNotNone(overdue, "fixture needs an unpaid past-due instance")
        self.assertIsNotNone(upcoming, "fixture needs an upcoming instance")

        res = self.client.delete(self.url)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(RecurringTransaction.objects.filter(pk=self.rt.pk).exists())

        paid.refresh_from_db()
        self.assertIsNone(paid.recurring_id, "paid instance should survive, detached from the schedule")
        self.assertTrue(Transaction.objects.filter(pk=overdue.pk).exists(), "an overdue bill is still owed")
        self.assertFalse(Transaction.objects.filter(pk=upcoming.pk).exists(), "upcoming placeholder should go")

    def test_delete_no_longer_needs_a_permanent_flag(self):
        """The soft path was only ever reached by Deactivate, which no longer exists."""
        res = self.client.delete(self.url)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(RecurringTransaction.objects.filter(pk=self.rt.pk).exists())


class TestCategoryMonthlyTarget(BudgetViewTestCase):
    """
    A category's monthly target has to be settable, and settable safely.

    monthly_budget is the target the dashboard compares assigned against, and the dashboard now
    hides it once the target is met — so the category editor has to be able to set it. The create
    view ignored the field entirely, and the update view assigned it straight from the request
    into a DecimalField, so a non-numeric value raised on save: a 500 rather than a rejection.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.create_url = reverse("budget:category-create", kwargs={"budget_pk": self.budget.pk})
        self.edit_url = reverse("budget:category-edit", kwargs={"budget_pk": self.budget.pk, "pk": self.expense_cat.pk})

    def test_create_accepts_a_monthly_target(self):
        res = self.client.post(
            self.create_url,
            data=json.dumps({"name": "Fuel", "category_type": Category.TYPE_EXPENSE, "monthly_budget": "200.00"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Category.objects.get(budget=self.budget, name="Fuel").monthly_budget, Decimal("200.00"))

    def test_create_without_a_target_still_works(self):
        res = self.client.post(
            self.create_url,
            data=json.dumps({"name": "Sundries", "category_type": Category.TYPE_EXPENSE}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Category.objects.get(budget=self.budget, name="Sundries").monthly_budget, Decimal("0"))

    def test_patch_updates_the_target(self):
        res = self._patch_json(self.edit_url, {"monthly_budget": "313.83"})
        self.assertEqual(res.status_code, 200)
        self.expense_cat.refresh_from_db()
        self.assertEqual(self.expense_cat.monthly_budget, Decimal("313.83"))

    def test_bad_target_is_rejected_not_a_500(self):
        res = self._patch_json(self.edit_url, {"monthly_budget": "not-a-number"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("monthly_budget", res.json()["errors"])

    def test_blank_target_clears_it(self):
        self.expense_cat.monthly_budget = Decimal("200.00")
        self.expense_cat.save(update_fields=["monthly_budget"])
        res = self._patch_json(self.edit_url, {"monthly_budget": ""})
        self.assertEqual(res.status_code, 200)
        self.expense_cat.refresh_from_db()
        self.assertEqual(self.expense_cat.monthly_budget, Decimal("0"))


class TestBudgetDelete(BudgetViewTestCase):
    """
    Deleting a budget must succeed even when it has history.

    Budget → Category is CASCADE, but TransactionLine.category and
    RecurringTransaction.category are PROTECT, so deleting any non-empty budget raised
    ProtectedError, which the view did not catch — a 500 for every real budget.
    """

    def test_deleting_a_budget_with_history_succeeds(self):
        txn = Transaction.objects.create(budget=self.budget, description="Rent", due_date=datetime.date(2026, 1, 1))
        TransactionLine.objects.create(
            transaction=txn, category=self.expense_cat, amount=Decimal("20.00"), amount_usd=Decimal("20.00")
        )
        RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.expense_cat,
            created_by=self.user,
            name="Rent",
            amount=Decimal("20.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=datetime.date(2026, 1, 1),
        )
        budget_pk = self.budget.pk
        self.client.force_login(self.user)
        res = self.client.delete(reverse("budget:delete", kwargs={"budget_pk": budget_pk}))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Budget.objects.filter(pk=budget_pk).exists())
        self.assertFalse(Transaction.objects.filter(budget_id=budget_pk).exists())
        self.assertFalse(Category.objects.filter(budget_id=budget_pk).exists())


class TestCategoryBudgetUpdate(BudgetViewTestCase):
    """
    The assigned-amount endpoint must answer with JSON and validate its input.

    It used to return a redirect to the dashboard. Its only callers are fetch() from the
    dashboard's inline edit and the two assign modals, all of which follow the 302, receive
    HTML, and then throw parsing it — so a save that had actually been written surfaced to the
    user as a failure. `assigned` also went into the database unparsed, making a non-numeric
    value a 500 and silently accepting a negative one.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.url = reverse(
            "budget:category-budget-update",
            kwargs={"budget_pk": self.budget.pk, "category_pk": self.expense_cat.pk},
        )

    def test_returns_json_not_a_redirect(self):
        res = self._patch_json(self.url, {"assigned": "123.45", "month": "2026-08"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/json")
        self.assertEqual(res.json()["assigned"], "123.45")

    def test_persists_the_amount(self):
        self._patch_json(self.url, {"assigned": "80.00", "month": "2026-08"})
        row = CategoryBudget.objects.get(budget=self.budget, category=self.expense_cat)
        self.assertEqual(row.assigned, Decimal("80.00"))
        self.assertEqual(row.month, datetime.date(2026, 8, 1))

    def test_second_write_updates_rather_than_duplicating(self):
        for amount in ("10.00", "20.00"):
            self._patch_json(self.url, {"assigned": amount, "month": "2026-08"})
        rows = CategoryBudget.objects.filter(budget=self.budget, category=self.expense_cat)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().assigned, Decimal("20.00"))

    def test_zero_is_allowed(self):
        res = self._patch_json(self.url, {"assigned": "0", "month": "2026-08"})
        self.assertEqual(res.status_code, 200)

    def test_non_numeric_is_a_400_not_a_500(self):
        res = self._patch_json(self.url, {"assigned": "abc", "month": "2026-08"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("assigned", res.json()["errors"])

    def test_negative_is_rejected(self):
        res = self._patch_json(self.url, {"assigned": "-5", "month": "2026-08"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("assigned", res.json()["errors"])
        self.assertFalse(CategoryBudget.objects.filter(category=self.expense_cat).exists())

    def test_bad_month_is_rejected(self):
        res = self._patch_json(self.url, {"assigned": "10", "month": "nope"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("month", res.json()["errors"])

    def test_another_budgets_category_is_not_reachable(self):
        other = Budget.objects.create(created_by=self.user)
        stranger = Category.objects.create(budget=other, name="Theirs", category_type=Category.TYPE_EXPENSE)
        url = reverse(
            "budget:category-budget-update",
            kwargs={"budget_pk": self.budget.pk, "category_pk": stranger.pk},
        )
        self.assertEqual(self._patch_json(url, {"assigned": "10", "month": "2026-08"}).status_code, 404)


class TestBudgetCopy(BudgetViewTestCase):
    """
    Copying a budget must reproduce its categories, not a flattened sketch of them.

    BudgetCreateView bulk_created categories carrying only name and category_type, so every
    subcategory became top-level and rollover, its base amount, the monthly target and every goal
    were dropped. Nothing raised, so the damage only showed up later. The budget and its owner
    membership were also created outside any atomic block, so a failure mid-copy left an orphaned
    half-built budget.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.url = reverse("budget:create")

        self.parent = Category.objects.create(
            budget=self.budget, name="Home", category_type=Category.TYPE_EXPENSE, monthly_budget=Decimal("500.00")
        )
        self.child = Category.objects.create(
            budget=self.budget, name="Repairs", category_type=Category.TYPE_EXPENSE, parent=self.parent
        )
        self.rolling = Category.objects.create(
            budget=self.budget,
            name="Car",
            category_type=Category.TYPE_EXPENSE,
            rollover=True,
            base_amount=Decimal("100.00"),
            rollover_start=datetime.date(2025, 1, 1),
        )
        self.goal_cat = Category.objects.create(budget=self.budget, name="Roof", category_type=Category.TYPE_EXPENSE)
        Goal.objects.create(
            category=self.goal_cat, target=Decimal("9000.00"), due_date=datetime.date(2027, 6, 1), ongoing=False
        )
        # A system category is created by the feature that needs it, so a copy should not inherit one.
        # The retired Transfers placeholder is the only kind left, kept because old lines point at it.
        Category.objects.create(
            budget=self.budget, name="Transfers", category_type=Category.TYPE_EXPENSE, is_system=True
        )

    def _copy(self):
        res = self.client.post(
            self.url,
            data=json.dumps({"name": "Copy", "copy_from": self.budget.pk, "copy_members": False}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        return Budget.objects.get(pk=res.json()["id"])

    def test_nesting_survives(self):
        copy = self._copy()
        child = Category.objects.get(budget=copy, name="Repairs")
        self.assertIsNotNone(child.parent, "the subcategory was flattened to the top level")
        self.assertEqual(child.parent.name, "Home")

    def test_monthly_target_survives(self):
        copy = self._copy()
        self.assertEqual(Category.objects.get(budget=copy, name="Home").monthly_budget, Decimal("500.00"))

    def test_rollover_and_base_amount_survive(self):
        copy = self._copy()
        car = Category.objects.get(budget=copy, name="Car")
        self.assertTrue(car.rollover)
        self.assertEqual(car.base_amount, Decimal("100.00"))

    def test_rollover_accrual_restarts_in_the_new_budget(self):
        """Carrying the source's start date would accrue over months this budget has no data for."""
        copy = self._copy()
        car = Category.objects.get(budget=copy, name="Car")
        self.assertEqual(car.rollover_start, timezone.localdate().replace(day=1))

    def test_goals_survive_with_their_target_and_due_date(self):
        copy = self._copy()
        roof = Category.objects.get(budget=copy, name="Roof")
        self.assertTrue(roof.is_goal, "the goal was dropped, leaving a plain category behind")
        self.assertEqual(roof.goal.target, Decimal("9000.00"))
        self.assertEqual(roof.goal.due_date, datetime.date(2027, 6, 1))

    def test_a_copied_goal_starts_empty(self):
        """Only the target copies. No transactions are copied, so nothing is saved toward it yet."""
        copy = self._copy()
        roof = Category.objects.get(budget=copy, name="Roof")
        self.assertEqual(TransactionLine.objects.filter(category=roof).count(), 0)

    def test_a_system_category_is_not_copied(self):
        copy = self._copy()
        self.assertFalse(Category.objects.filter(budget=copy, is_system=True).exists())

    def test_a_failed_copy_leaves_no_orphaned_budget(self):
        before = Budget.objects.count()
        with (
            mock.patch("apps.budget.views._copy_budget_categories", side_effect=RuntimeError("boom")),
            self.assertRaises(RuntimeError),
        ):
            self.client.post(
                self.url,
                data=json.dumps({"name": "Doomed", "copy_from": self.budget.pk}),
                content_type="application/json",
            )
        self.assertEqual(Budget.objects.count(), before, "a half-built budget survived the failure")
