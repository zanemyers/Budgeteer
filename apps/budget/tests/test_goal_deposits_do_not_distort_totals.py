"""
Tests that a `transaction_type="transfer"` row stays out of the headline numbers.

This is what is left of the retired two-leg transfer feature. The type value survives because goal
deposits are written with it, and `data.py` leans on that in both directions: income_total matches
`transaction_type="income"` exactly, and category activity excludes "transfer" outright. Move $500
into a goal and it must not read as $500 of income *or* $500 of spending, or Ready to Assign — the
one number PRODUCT.md says the app exists to deliver — drifts.
"""

import datetime
from decimal import Decimal

from apps.base.tests import BaseTest
from apps.budget.data import get_budget_overview
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    CategoryBudget,
    PaymentMethod,
    Transaction,
    TransactionLine,
)

MONTH = datetime.date(2026, 5, 1)
MID_MONTH = datetime.date(2026, 5, 15)


class GoalDepositTestCase(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.expense_cat = Category.objects.create(budget=self.budget, name="Rent", category_type=Category.TYPE_EXPENSE)
        self.checking = PaymentMethod.objects.create(budget=self.budget, name="Checking")
        self.savings = PaymentMethod.objects.create(budget=self.budget, name="Savings")

    def make_txn(self, amount, *, category, txn_type="", paid=MID_MONTH, pm=None, description="Move"):
        t = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description=description,
            due_date=paid or MID_MONTH,
            paid_date=paid,
            payment_method=pm,
            transaction_type=txn_type,
        )
        TransactionLine.objects.create(
            transaction=t, category=category, amount=Decimal(amount), amount_usd=Decimal(amount)
        )
        return t

    def overview(self):
        return get_budget_overview(self.budget, MONTH.strftime("%Y-%m"))


class TestTransferTypedRowsAreExcluded(GoalDepositTestCase):
    def test_baseline_income_counts_toward_ready_to_assign(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        overview = self.overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(overview["ready_to_assign"]), Decimal("1000.00"))

    def test_a_transfer_typed_row_does_not_change_income_or_ready_to_assign(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        before = self.overview()

        self.make_txn(
            "500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking, description="To savings"
        )
        self.make_txn(
            "500.00", category=self.income_cat, txn_type="transfer", pm=self.savings, description="From checking"
        )

        after = self.overview()
        self.assertEqual(after["income_total"], before["income_total"])
        self.assertEqual(after["ready_to_assign"], before["ready_to_assign"])

    def test_a_transfer_typed_row_does_not_register_as_category_spending(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        CategoryBudget.objects.create(
            budget=self.budget, category=self.expense_cat, month=MONTH, assigned=Decimal("600.00")
        )
        self.make_txn(
            "500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking, description="To savings"
        )

        row = next(r for r in self.overview()["categories"] if r["id"] == self.expense_cat.pk)
        self.assertEqual(Decimal(row["activity"]), Decimal("0.00"))
        self.assertEqual(Decimal(row["available"]), Decimal("600.00"))

    def test_an_income_typed_row_is_not_excluded(self):
        """
        The type is the only thing doing the excluding now.

        The old pairing was a second safety net for legs typed as ordinary income/expense. With it
        gone, an income-typed row counts as income — which is correct, and worth pinning so the
        exclusion above is not mistaken for something broader than it is.
        """
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        self.make_txn("500.00", category=self.income_cat, txn_type="income", pm=self.savings, description="Also income")
        self.assertEqual(Decimal(self.overview()["income_total"]), Decimal("1500.00"))
