import datetime
import json
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.base.tests import BaseTest
from apps.budget.data import get_budget_overview
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    CategoryBudget,
    PaymentMethod,
    PaySchedule,
    Transaction,
    TransactionLine,
    default_income_budget_month,
    match_pay_schedule,
)


class TestPayScheduleAllocation(BaseTest):
    def test_budget_month_for_offset_zero(self):
        schedule = PaySchedule(allocation_offset_months=0)
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 31)), datetime.date(2026, 7, 1))

    def test_budget_month_for_offset_one(self):
        schedule = PaySchedule(allocation_offset_months=1)
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 31)), datetime.date(2026, 8, 1))

    def test_budget_month_for_year_wraparound(self):
        schedule = PaySchedule(allocation_offset_months=1)
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 12, 15)), datetime.date(2027, 1, 1))

    def test_semimonthly_only_later_check_funds_next_month(self):
        # Middle + end of month, budgeting a month ahead: only the end-of-month check rolls forward.
        schedule = PaySchedule(
            frequency=PaySchedule.FREQ_SEMIMONTHLY,
            anchor_1=PaySchedule.ANCHOR_MIDDLE,
            anchor_2=PaySchedule.ANCHOR_END,
            allocation_offset_months=1,
        )
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 15)), datetime.date(2026, 7, 1))
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 31)), datetime.date(2026, 8, 1))

    def test_semimonthly_start_and_middle(self):
        # Beginning + middle: the 1st funds the received month, the 15th rolls to next month.
        schedule = PaySchedule(
            frequency=PaySchedule.FREQ_SEMIMONTHLY,
            anchor_1=PaySchedule.ANCHOR_BEGINNING,
            anchor_2=PaySchedule.ANCHOR_MIDDLE,
            allocation_offset_months=1,
        )
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 1)), datetime.date(2026, 7, 1))
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 15)), datetime.date(2026, 8, 1))

    def test_semimonthly_offset_zero_both_current(self):
        schedule = PaySchedule(
            frequency=PaySchedule.FREQ_SEMIMONTHLY,
            anchor_1=PaySchedule.ANCHOR_MIDDLE,
            anchor_2=PaySchedule.ANCHOR_END,
            allocation_offset_months=0,
        )
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 15)), datetime.date(2026, 7, 1))
        self.assertEqual(schedule.budget_month_for(datetime.date(2026, 7, 31)), datetime.date(2026, 7, 1))

    def test_default_income_budget_month_none_without_schedule(self):
        user = self.make_user()
        budget = Budget.objects.create(created_by=user)
        self.assertIsNone(default_income_budget_month(budget, datetime.date(2026, 7, 31)))

    def test_default_income_budget_month_uses_schedule(self):
        user = self.make_user()
        budget = Budget.objects.create(created_by=user)
        PaySchedule.objects.create(budget=budget, name="Job", allocation_offset_months=1)
        self.assertEqual(
            default_income_budget_month(budget, datetime.date(2026, 7, 31)),
            datetime.date(2026, 8, 1),
        )


class TestPayScheduleMatching(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)

    def test_single_criteria_less_schedule_is_default(self):
        schedule = PaySchedule.objects.create(budget=self.budget, name="Job", allocation_offset_months=1)
        matched = match_pay_schedule(self.budget, amount=Decimal("1234.00"), description="anything")
        self.assertEqual(matched, schedule)

    def test_matches_by_amount(self):
        a = PaySchedule.objects.create(budget=self.budget, name="Acme", expected_amount=Decimal("2000.00"))
        PaySchedule.objects.create(budget=self.budget, name="Beta", expected_amount=Decimal("500.00"))
        matched = match_pay_schedule(self.budget, amount=Decimal("2015.00"), description="")
        self.assertEqual(matched, a)

    def test_matches_by_description(self):
        PaySchedule.objects.create(budget=self.budget, name="Acme", match_text="ACME")
        beta = PaySchedule.objects.create(budget=self.budget, name="Beta", match_text="BETA CORP")
        matched = match_pay_schedule(self.budget, amount=None, description="Direct deposit BETA CORP payroll")
        self.assertEqual(matched, beta)

    def test_variable_pay_matches_by_description_regardless_of_amount(self):
        # A part-time job with no fixed amount: match on description alone across differing amounts.
        ps = PaySchedule.objects.create(budget=self.budget, name="Part-time", match_text="GIG CO")
        self.assertEqual(match_pay_schedule(self.budget, amount=Decimal("312.40"), description="GIG CO payout"), ps)
        self.assertEqual(match_pay_schedule(self.budget, amount=Decimal("1180.00"), description="GIG CO payout"), ps)

    def test_no_match_returns_none(self):
        PaySchedule.objects.create(
            budget=self.budget, name="Acme", expected_amount=Decimal("2000.00"), match_text="ACME"
        )
        self.assertIsNone(match_pay_schedule(self.budget, amount=Decimal("50.00"), description="coffee refund"))


class TestBudgetAheadOverview(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.expense_cat = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)

    def _income(self, amount, paid_date, budget_month=None):
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="Paycheck",
            due_date=paid_date,
            paid_date=paid_date,
            budget_month=budget_month,
            transaction_type="income",
        )
        TransactionLine.objects.create(transaction=txn, category=self.income_cat, amount=amount, amount_usd=amount)
        return txn

    def _assign(self, amount, month):
        CategoryBudget.objects.create(budget=self.budget, category=self.expense_cat, month=month, assigned=amount)

    def test_income_targeted_to_future_month(self):
        # Received July 31, targeted at August's budget.
        self._income(Decimal("1000.00"), datetime.date(2026, 7, 31), datetime.date(2026, 8, 1))
        july = get_budget_overview(self.budget, "2026-07")
        august = get_budget_overview(self.budget, "2026-08")

        self.assertEqual(Decimal(july["income_total"]), Decimal("0.00"))
        self.assertEqual(Decimal(august["income_total"]), Decimal("1000.00"))
        # Cumulative Ready to Assign: nothing available in July, the paycheck in August.
        self.assertEqual(Decimal(july["ready_to_assign"]), Decimal("0.00"))
        self.assertEqual(Decimal(august["ready_to_assign"]), Decimal("1000.00"))

    def test_income_without_budget_month_falls_back_to_paid_date(self):
        self._income(Decimal("1000.00"), datetime.date(2026, 7, 15))
        july = get_budget_overview(self.budget, "2026-07")
        self.assertEqual(Decimal(july["income_total"]), Decimal("1000.00"))

    def test_surplus_does_not_carry_forward(self):
        # July income 1000, assign 600 in July → 400 left in July. Surplus does NOT roll into August.
        self._income(Decimal("1000.00"), datetime.date(2026, 7, 15))
        self._assign(Decimal("600.00"), datetime.date(2026, 7, 1))
        july = get_budget_overview(self.budget, "2026-07")
        august = get_budget_overview(self.budget, "2026-08")
        self.assertEqual(Decimal(july["ready_to_assign"]), Decimal("400.00"))
        self.assertEqual(Decimal(august["ready_to_assign"]), Decimal("0.00"))

    def test_overassignment_makes_rta_negative_same_month(self):
        self._income(Decimal("500.00"), datetime.date(2026, 7, 15))
        self._assign(Decimal("800.00"), datetime.date(2026, 7, 1))
        july = get_budget_overview(self.budget, "2026-07")
        self.assertEqual(Decimal(july["ready_to_assign"]), Decimal("-300.00"))


class TestPayScheduleViews(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.client.force_login(self.user)

    def _patch(self, url, payload):
        return self.client.patch(url, data=json.dumps(payload), content_type="application/json")

    def _post(self, url, payload):
        return self.client.post(url, data=json.dumps(payload), content_type="application/json")

    def test_pay_schedule_create(self):
        url = reverse("budget:pay-schedule-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(
            url,
            {
                "name": "Acme",
                "frequency": "semimonthly",
                "anchor_1": "middle",
                "anchor_2": "end",
                "allocation_offset_months": 1,
                "expected_amount": "2000.00",
                "match_text": "ACME",
            },
        )
        self.assertEqual(res.status_code, 201)
        schedule = PaySchedule.objects.get(budget=self.budget)
        self.assertEqual(schedule.name, "Acme")
        self.assertEqual(schedule.frequency, "semimonthly")
        self.assertEqual(schedule.anchor_1, "middle")
        self.assertEqual(schedule.anchor_2, "end")
        self.assertEqual(schedule.allocation_offset_months, 1)
        self.assertEqual(schedule.expected_amount, Decimal("2000.00"))

    def test_create_with_income_category(self):
        url = reverse("budget:pay-schedule-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(url, {"name": "Acme", "category": self.income_cat.pk})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["category"], self.income_cat.pk)
        self.assertEqual(PaySchedule.objects.get(budget=self.budget).category_id, self.income_cat.pk)

    def test_create_ignores_expense_category(self):
        expense = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)
        url = reverse("budget:pay-schedule-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(url, {"name": "Acme", "category": expense.pk})
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(PaySchedule.objects.get(budget=self.budget).category_id)

    def test_pay_schedule_create_requires_name(self):
        url = reverse("budget:pay-schedule-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(url, {"frequency": "monthly"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("name", res.json()["errors"])

    def test_pay_schedule_edit_and_delete(self):
        schedule = PaySchedule.objects.create(budget=self.budget, name="Acme", allocation_offset_months=0)
        url = reverse("budget:pay-schedule-detail", kwargs={"budget_pk": self.budget.pk, "pk": schedule.pk})
        res = self._patch(url, {"name": "Acme", "frequency": "monthly", "allocation_offset_months": 1})
        self.assertEqual(res.status_code, 200)
        schedule.refresh_from_db()
        self.assertEqual(schedule.allocation_offset_months, 1)

        res = self.client.delete(url)
        self.assertIn(res.status_code, (200, 204))
        self.assertFalse(PaySchedule.objects.filter(pk=schedule.pk).exists())

    def test_income_create_auto_assigns_next_month(self):
        PaySchedule.objects.create(budget=self.budget, name="Job", allocation_offset_months=1)
        url = reverse("budget:transaction-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(
            url,
            {
                "description": "Paycheck",
                "due_date": "2026-07-31",
                "paid_date": "2026-07-31",
                "transaction_type": "income",
                "lines": [{"category": self.income_cat.pk, "amount": "1000.00"}],
            },
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["budget_month"], "2026-08-01")
        txn = Transaction.objects.get(pk=res.json()["id"])
        self.assertEqual(txn.budget_month, datetime.date(2026, 8, 1))

    def test_income_create_matches_schedule_by_amount(self):
        PaySchedule.objects.create(
            budget=self.budget, name="Acme", expected_amount=Decimal("2000.00"), allocation_offset_months=1
        )
        PaySchedule.objects.create(
            budget=self.budget, name="Beta", expected_amount=Decimal("500.00"), allocation_offset_months=0
        )
        url = reverse("budget:transaction-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(
            url,
            {
                "description": "Paycheck",
                "due_date": "2026-07-31",
                "paid_date": "2026-07-31",
                "transaction_type": "income",
                "lines": [{"category": self.income_cat.pk, "amount": "2000.00"}],
            },
        )
        self.assertEqual(res.status_code, 201)
        # Matched Acme (offset 1) → August, not Beta (offset 0).
        self.assertEqual(res.json()["budget_month"], "2026-08-01")

    def test_income_create_honors_explicit_budget_month(self):
        PaySchedule.objects.create(budget=self.budget, name="Job", allocation_offset_months=1)
        url = reverse("budget:transaction-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(
            url,
            {
                "description": "Paycheck",
                "due_date": "2026-07-31",
                "paid_date": "2026-07-31",
                "transaction_type": "income",
                "budget_month": "2026-09",
                "lines": [{"category": self.income_cat.pk, "amount": "1000.00"}],
            },
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["budget_month"], "2026-09-01")

    def _placeholder_paycheck(self, amount):
        ps = PaySchedule.objects.create(budget=self.budget, name="Gig", category=self.income_cat)
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="Gig",
            due_date=datetime.date(2026, 7, 31),
            transaction_type="income",
            pay_schedule=ps,
        )
        TransactionLine.objects.create(transaction=txn, category=self.income_cat, amount=amount, amount_usd=amount)
        return txn

    def test_cannot_mark_placeholder_paid_without_amount(self):
        txn = self._placeholder_paycheck(Decimal("0.00"))
        url = reverse("budget:transaction-mark-paid", kwargs={"budget_pk": self.budget.pk, "pk": txn.pk})
        res = self.client.post(url, data=json.dumps({}), content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("amount", res.json()["errors"])
        txn.refresh_from_db()
        self.assertIsNone(txn.paid_date)

    def test_can_mark_placeholder_paid_after_amount_set(self):
        txn = self._placeholder_paycheck(Decimal("450.00"))
        url = reverse("budget:transaction-mark-paid", kwargs={"budget_pk": self.budget.pk, "pk": txn.pk})
        res = self.client.post(url, data=json.dumps({}), content_type="application/json")
        self.assertEqual(res.status_code, 200)
        txn.refresh_from_db()
        self.assertIsNotNone(txn.paid_date)

    def test_non_owner_cannot_create_schedule(self):
        other = self.make_user("other.user")
        BudgetMembership.objects.create(budget=self.budget, user=other, role=BudgetMembership.ROLE_MEMBER)
        self.client.force_login(other)
        url = reverse("budget:pay-schedule-create", kwargs={"budget_pk": self.budget.pk})
        res = self._post(url, {"name": "Sneaky", "frequency": "monthly"})
        self.assertIn(res.status_code, (403, 404))


class TestPayScheduleBankCreate(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.pm = PaymentMethod.objects.create(budget=self.budget, name="Checking")
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="B")
        self.acct = BankAccount.objects.create(
            connection=self.conn, simplefin_id="a1", name="Checking", payment_method=self.pm
        )
        self.client.force_login(self.user)

    def test_bank_deposit_uses_matched_schedule_category_and_month(self):
        PaySchedule.objects.create(
            budget=self.budget,
            name="Acme",
            category=self.income_cat,
            expected_amount=Decimal("2000.00"),
            match_text="ACME",
            allocation_offset_months=1,
        )
        bt = BankTransaction.objects.create(
            bank_account=self.acct,
            simplefin_id="t1",
            posted_at=timezone.make_aware(datetime.datetime(2026, 7, 31, 12, 0)),
            amount=Decimal("2000.00"),
            description="ACME PAYROLL",
            payee="ACME PAYROLL",
        )
        url = reverse("budget:bank-txn-create", kwargs={"budget_pk": self.budget.pk, "pk": bt.pk})
        # No category_id supplied — it should default from the matched schedule.
        res = self.client.post(url, data=json.dumps({}), content_type="application/json")
        self.assertEqual(res.status_code, 201)
        txn = res.json()["transaction"]
        self.assertEqual(txn["lines"][0]["category"], self.income_cat.pk)
        self.assertEqual(txn["budget_month"], "2026-08-01")


class TestPayScheduleGeneration(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)

    def _schedule(self, **kwargs):
        defaults = dict(budget=self.budget, name="Job", category=self.income_cat, expected_amount=Decimal("1000.00"))
        defaults.update(kwargs)
        return PaySchedule.objects.create(**defaults)

    def test_paydays_semimonthly(self):
        s = self._schedule(
            frequency=PaySchedule.FREQ_SEMIMONTHLY, anchor_1=PaySchedule.ANCHOR_MIDDLE, anchor_2=PaySchedule.ANCHOR_END
        )
        days = s.paydays_between(datetime.date(2026, 7, 1), datetime.date(2026, 8, 31))
        self.assertEqual(
            days,
            [
                datetime.date(2026, 7, 15),
                datetime.date(2026, 7, 31),
                datetime.date(2026, 8, 15),
                datetime.date(2026, 8, 31),
            ],
        )

    def test_paydays_biweekly(self):
        s = self._schedule(frequency=PaySchedule.FREQ_BIWEEKLY, anchor_date=datetime.date(2026, 7, 3))
        days = s.paydays_between(datetime.date(2026, 7, 1), datetime.date(2026, 8, 1))
        self.assertEqual(days, [datetime.date(2026, 7, 3), datetime.date(2026, 7, 17), datetime.date(2026, 7, 31)])

    def test_generate_creates_pending_income(self):
        s = self._schedule(
            frequency=PaySchedule.FREQ_SEMIMONTHLY,
            anchor_1=PaySchedule.ANCHOR_MIDDLE,
            anchor_2=PaySchedule.ANCHOR_END,
            allocation_offset_months=1,
        )
        created = s.generate_instances_up_to(datetime.date(2026, 7, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(len(created), 2)
        txns = Transaction.objects.filter(pay_schedule=s).order_by("due_date")
        self.assertEqual([t.due_date for t in txns], [datetime.date(2026, 7, 15), datetime.date(2026, 7, 31)])
        # All pending income with a category line.
        for t in txns:
            self.assertIsNone(t.paid_date)
            self.assertEqual(t.transaction_type, "income")
            self.assertEqual(t.lines.first().category_id, self.income_cat.pk)
        # Semimonthly split: 15th funds July, 31st funds August.
        self.assertEqual(txns[0].budget_month, datetime.date(2026, 7, 1))
        self.assertEqual(txns[1].budget_month, datetime.date(2026, 8, 1))

    def test_generate_is_idempotent_and_incremental(self):
        s = self._schedule(frequency=PaySchedule.FREQ_MONTHLY, anchor_1=PaySchedule.ANCHOR_END)
        first = s.generate_instances_up_to(datetime.date(2026, 7, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(len(first), 1)
        # Re-running to the same date creates nothing new.
        again = s.generate_instances_up_to(datetime.date(2026, 7, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(len(again), 0)
        # Extending the window adds the next month.
        more = s.generate_instances_up_to(datetime.date(2026, 8, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(len(more), 1)
        self.assertEqual(Transaction.objects.filter(pay_schedule=s).count(), 2)

    def test_generates_placeholder_without_amount(self):
        # Variable pay: category set, no amount → pending placeholder paychecks (amount 0).
        s = self._schedule(frequency=PaySchedule.FREQ_MONTHLY, anchor_1=PaySchedule.ANCHOR_END, expected_amount=None)
        created = s.generate_instances_up_to(datetime.date(2026, 7, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(len(created), 1)
        txn = created[0]
        self.assertIsNone(txn.paid_date)
        self.assertEqual(txn.total_amount, Decimal("0.00"))
        self.assertEqual(txn.lines.first().category_id, self.income_cat.pk)

    def test_no_generation_without_category(self):
        s = self._schedule(frequency=PaySchedule.FREQ_MONTHLY, anchor_1=PaySchedule.ANCHOR_END, category=None)
        created = s.generate_instances_up_to(datetime.date(2026, 12, 31), since=datetime.date(2026, 7, 1))
        self.assertEqual(created, [])


class TestCategoryRollover(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)

    def _cat(self, rollover, base="0.00", start=None):
        return Category.objects.create(
            budget=self.budget,
            name="Personal",
            category_type=Category.TYPE_EXPENSE,
            rollover=rollover,
            base_amount=Decimal(base),
            rollover_start=start,
        )

    def _spend(self, cat, amount, paid_date):
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="spend",
            due_date=paid_date,
            paid_date=paid_date,
            transaction_type="expense",
        )
        TransactionLine.objects.create(transaction=txn, category=cat, amount=amount, amount_usd=amount)

    def _row(self, overview, cat):
        return next(r for r in overview["categories"] if r["id"] == cat.pk)

    def test_base_accrues_and_leftover_carries(self):
        # Base $100/mo starting July. July: spend 30 → 70 left. August: base + 70 carryover.
        cat = self._cat(rollover=True, base="100.00", start=datetime.date(2026, 7, 1))
        self._spend(cat, Decimal("30.00"), datetime.date(2026, 7, 10))
        july = self._row(get_budget_overview(self.budget, "2026-07"), cat)
        august = self._row(get_budget_overview(self.budget, "2026-08"), cat)
        # The base sets the BUDGETED target, not assigned.
        self.assertEqual(Decimal(july["budgeted"]), Decimal("100.00"))
        self.assertEqual(Decimal(july["assigned"]), Decimal("0.00"))
        self.assertEqual(Decimal(july["available"]), Decimal("70.00"))
        # August: base 100 + 70 carried = 170 budgeted, nothing spent, 170 available.
        self.assertEqual(Decimal(august["budgeted"]), Decimal("170.00"))
        self.assertEqual(Decimal(august["available"]), Decimal("170.00"))

    def test_overspend_resets_to_base_next_month(self):
        # Base $100 from July. Overspend in July ($130) → next month resets to base, no negative carryover.
        cat = self._cat(rollover=True, base="100.00", start=datetime.date(2026, 7, 1))
        self._spend(cat, Decimal("130.00"), datetime.date(2026, 7, 10))
        july = self._row(get_budget_overview(self.budget, "2026-07"), cat)
        august = self._row(get_budget_overview(self.budget, "2026-08"), cat)
        self.assertEqual(Decimal(july["available"]), Decimal("-30.00"))  # overspent this month
        # August resets to just the base — the -30 does NOT carry forward.
        self.assertEqual(Decimal(august["budgeted"]), Decimal("100.00"))
        self.assertEqual(Decimal(august["available"]), Decimal("100.00"))

    def test_exactly_zero_leftover_resets_to_base(self):
        cat = self._cat(rollover=True, base="100.00", start=datetime.date(2026, 7, 1))
        self._spend(cat, Decimal("100.00"), datetime.date(2026, 7, 10))  # spend it all → 0 left
        august = self._row(get_budget_overview(self.budget, "2026-08"), cat)
        self.assertEqual(Decimal(august["budgeted"]), Decimal("100.00"))

    def test_no_accrual_before_start_month(self):
        cat = self._cat(rollover=True, base="100.00", start=datetime.date(2026, 8, 1))
        july = self._row(get_budget_overview(self.budget, "2026-07"), cat)
        # Before the start month, the base isn't accruing yet.
        self.assertEqual(Decimal(july["available"]), Decimal("0.00"))

    def test_rollover_does_not_touch_ready_to_assign(self):
        cat = self._cat(rollover=True, base="100.00", start=datetime.date(2026, 7, 1))
        august = get_budget_overview(self.budget, "2026-08")
        # The base sets the budgeted target only — it never draws from Ready to Assign.
        self.assertEqual(Decimal(august["expense_assigned"]), Decimal("0.00"))
