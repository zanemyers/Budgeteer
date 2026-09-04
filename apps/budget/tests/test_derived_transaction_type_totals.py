"""
Tests that the overview totals see a transaction whose `transaction_type` column is blank.

Blank is the normal state: `Transaction.derive_transaction_type()` falls back to the first line's
category type, and the column is only written when something needs to override that. Roughly one
transaction in five is stored that way. The aggregates in `data.py` cannot call that method, so
they filter a SQL port of it (`EFF_TYPE`) rather than the raw column — filtering the column
dropped blank-typed paychecks from Income while the income *category* rows, which key off the
category instead, still showed them. The two figures sit one above the other on the dashboard.
"""

import datetime
from decimal import Decimal

from apps.base.tests import BaseTest
from apps.budget.data import get_budget_overview, get_goal_total_saved
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    CategoryBudget,
    Goal,
    Transaction,
    TransactionLine,
)

MONTH = datetime.date(2026, 5, 1)
MID_MONTH = datetime.date(2026, 5, 15)


class DerivedTypeTestCase(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.expense_cat = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)

    def make_txn(self, amount, *, category, txn_type="", paid=MID_MONTH, description="Entry"):
        t = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description=description,
            due_date=paid or MID_MONTH,
            paid_date=paid,
            transaction_type=txn_type,
        )
        TransactionLine.objects.create(
            transaction=t, category=category, amount=Decimal(amount), amount_usd=Decimal(amount)
        )
        return t

    def overview(self):
        return get_budget_overview(self.budget, MONTH.strftime("%Y-%m"))

    def income_row_total(self, overview):
        return sum(Decimal(c["activity"]) for c in overview["categories"] if c["category_type"] == "income")


class TestBlankTypeCountsFromItsCategory(DerivedTypeTestCase):
    def test_a_blank_typed_paycheck_counts_as_income(self):
        self.make_txn("1000.00", category=self.income_cat, description="Paycheck")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(overview["ready_to_assign"]), Decimal("1000.00"))

    def test_a_blank_typed_purchase_counts_as_spending(self):
        self.make_txn("120.00", category=self.expense_cat, description="Rent")
        row = next(r for r in self.overview()["categories"] if r["id"] == self.expense_cat.pk)
        self.assertEqual(Decimal(row["activity"]), Decimal("120.00"))

    def test_the_income_figure_and_its_category_rows_agree(self):
        """
        The regression itself.

        These two are printed one above the other, so a divergence is visible on the dashboard
        without any drilling in.
        """
        self.make_txn("2000.00", category=self.income_cat, description="Blank-typed paycheck")
        self.make_txn("500.00", category=self.income_cat, txn_type="income", description="Explicit paycheck")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("2500.00"))
        self.assertEqual(self.income_row_total(overview), Decimal("2500.00"))

    def test_a_stored_type_still_wins_over_the_category(self):
        """
        A stored value beats the category, as `derive_transaction_type` has it.

        The SQL port must agree, or a goal deposit typed "transfer" onto an expense category
        would read as ordinary spending.
        """
        self.make_txn("75.00", category=self.income_cat, txn_type="expense", description="Misfiled purchase")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("0.00"))
        self.assertEqual(self.income_row_total(overview), Decimal("0.00"))


class TestBlankTypeOnGoalCategories(DerivedTypeTestCase):
    def setUp(self):
        super().setUp()
        self.goal_cat = Category.objects.create(
            budget=self.budget, name="Vacation", category_type=Category.TYPE_EXPENSE
        )
        Goal.objects.create(category=self.goal_cat, target=Decimal("1000.00"))

    def test_a_blank_typed_withdrawal_reduces_the_goal_balance(self):
        self.make_txn("400.00", category=self.goal_cat, txn_type="transfer", description="Deposit")
        self.make_txn("150.00", category=self.goal_cat, description="Blank-typed spend from the goal")
        self.assertEqual(get_goal_total_saved(self.budget, self.goal_cat.pk), Decimal("250.00"))

    def test_a_blank_typed_withdrawal_shows_as_goal_spending_for_the_month(self):
        self.make_txn("400.00", category=self.goal_cat, txn_type="transfer", description="Deposit")
        self.make_txn("150.00", category=self.goal_cat, description="Blank-typed spend from the goal")
        self.assertEqual(Decimal(self.overview()["goal_monthly_spending"]), Decimal("150.00"))


class TestGoalDepositsAreNotIncome(DerivedTypeTestCase):
    """
    A deposit into a goal is money that was already counted when it arrived.

    Both deposit routes land in a goal category — the Goals page writes "transfer", a balance
    adjustment writes "income" — so the category is what identifies them, not the type.
    """

    def setUp(self):
        super().setUp()
        self.goal_cat = Category.objects.create(
            budget=self.budget, name="Vacation", category_type=Category.TYPE_EXPENSE
        )
        Goal.objects.create(category=self.goal_cat, target=Decimal("1000.00"))

    def assign(self, category, amount):
        CategoryBudget.objects.create(budget=self.budget, category=category, month=MONTH, assigned=Decimal(amount))

    def test_an_income_typed_deposit_does_not_inflate_income(self):
        self.make_txn("1000.00", category=self.income_cat, description="Paycheck")
        self.make_txn("200.00", category=self.goal_cat, txn_type="income", description="Vacation deposit")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(overview["saved_to_goals_total"]), Decimal("200.00"))

    def test_a_transfer_typed_deposit_does_not_inflate_income(self):
        self.make_txn("1000.00", category=self.income_cat, description="Paycheck")
        self.make_txn("200.00", category=self.goal_cat, txn_type="transfer", description="Vacation deposit")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(overview["saved_to_goals_total"]), Decimal("200.00"))

    def test_ready_to_assign_follows_the_assignment_not_the_deposit(self):
        """
        Assigning is what commits money, for a goal as for any other category.

        Charging the assignment *and* the deposit billed the same 200 twice, which only looked
        right while income_total was inflated by that same deposit.
        """
        self.make_txn("1000.00", category=self.income_cat, description="Paycheck")
        self.assign(self.goal_cat, "200.00")
        self.make_txn("200.00", category=self.goal_cat, txn_type="income", description="Vacation deposit")
        self.assertEqual(Decimal(self.overview()["ready_to_assign"]), Decimal("800.00"))


class TestOpeningBalancesStayOutOfMonthlyFlows(DerivedTypeTestCase):
    """
    A goal's opening balance is savings that already existed, so no month should show it moving.

    It still has to give the goal its balance, which is why `get_goal_total_saved` counts it and
    every monthly figure does not.
    """

    def setUp(self):
        super().setUp()
        self.goal_cat = Category.objects.create(
            budget=self.budget, name="Emergency Fund", category_type=Category.TYPE_EXPENSE
        )
        Goal.objects.create(category=self.goal_cat, target=Decimal("20000.00"))
        self.opening = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="Emergency Fund — opening balance",
            due_date=MID_MONTH,
            paid_date=MID_MONTH,
            transaction_type="income",
            is_opening_balance=True,
        )
        TransactionLine.objects.create(
            transaction=self.opening,
            category=self.goal_cat,
            amount=Decimal("15000.00"),
            amount_usd=Decimal("15000.00"),
        )

    def test_it_gives_the_goal_its_balance(self):
        self.assertEqual(get_goal_total_saved(self.budget, self.goal_cat.pk), Decimal("15000.00"))

    def test_it_does_not_read_as_income_or_as_money_saved_this_month(self):
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("0.00"))
        self.assertEqual(Decimal(overview["saved_to_goals_total"]), Decimal("0.00"))

    def test_it_does_not_punch_a_hole_in_ready_to_assign(self):
        """The regression: a 15,000 opening balance read as a 15,000 hole in the month recorded."""
        self.assertEqual(Decimal(self.overview()["ready_to_assign"]), Decimal("0.00"))

    def test_a_real_deposit_alongside_it_still_counts_as_saved(self):
        self.make_txn("300.00", category=self.goal_cat, txn_type="transfer", description="Top up")
        overview = self.overview()
        self.assertEqual(Decimal(overview["saved_to_goals_total"]), Decimal("300.00"))
        self.assertEqual(get_goal_total_saved(self.budget, self.goal_cat.pk), Decimal("15300.00"))
