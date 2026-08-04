"""
Tests for transfer linking and its effect on reported totals.

Two concerns:
1. link_transfer/unlink_transfer mutate a self-referential OneToOneField with raw .update()
   calls, so a half-linked pair or a unique-constraint violation is easy to introduce.
2. A linked transfer must not count as income or spending. If it does, moving money between
   your own accounts inflates Ready to Assign — the one number PRODUCT.md says the app
   exists to deliver.
"""

import datetime
from decimal import Decimal

from apps.base.tests import BaseTest
from apps.budget.data import find_transfer_candidates, get_budget_overview
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


class TransferTestCase(BaseTest):
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


class TestLinkTransfer(TransferTestCase):
    def test_linking_sets_both_sides(self):
        a = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        b = self.make_txn("100.00", category=self.income_cat, pm=self.savings)
        a.link_transfer(b)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.transfer_partner_id, b.pk)
        self.assertEqual(b.transfer_partner_id, a.pk)

    def test_unlinking_clears_both_sides(self):
        a = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        b = self.make_txn("100.00", category=self.income_cat, pm=self.savings)
        a.link_transfer(b)
        a.unlink_transfer()
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertIsNone(a.transfer_partner_id)
        self.assertIsNone(b.transfer_partner_id)

    def test_unlinking_an_unlinked_transaction_is_a_noop(self):
        a = self.make_txn("100.00", category=self.expense_cat)
        a.unlink_transfer()
        a.refresh_from_db()
        self.assertIsNone(a.transfer_partner_id)

    def test_relinking_clears_the_stale_back_reference_on_both_old_partners(self):
        """
        Re-linking must free both previous partners first.

        transfer_partner is a OneToOneField, so a leftover pointer at the new partner would
        trip its unique index. Re-linking A(-B) to D(-C) must free B and C first.
        """
        a = self.make_txn("100.00", category=self.expense_cat, pm=self.checking, description="A")
        b = self.make_txn("100.00", category=self.income_cat, pm=self.savings, description="B")
        c = self.make_txn("100.00", category=self.expense_cat, pm=self.checking, description="C")
        d = self.make_txn("100.00", category=self.income_cat, pm=self.savings, description="D")
        a.link_transfer(b)
        c.link_transfer(d)

        a.link_transfer(d)

        for obj in (a, b, c, d):
            obj.refresh_from_db()
        self.assertEqual(a.transfer_partner_id, d.pk)
        self.assertEqual(d.transfer_partner_id, a.pk)
        self.assertIsNone(b.transfer_partner_id)
        self.assertIsNone(c.transfer_partner_id)

    def test_relinking_to_the_same_partner_is_stable(self):
        a = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        b = self.make_txn("100.00", category=self.income_cat, pm=self.savings)
        a.link_transfer(b)
        a.link_transfer(b)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.transfer_partner_id, b.pk)
        self.assertEqual(b.transfer_partner_id, a.pk)

    def test_a_transaction_cannot_partner_with_itself(self):
        a = self.make_txn("100.00", category=self.expense_cat)
        with self.assertRaises(ValueError):
            a.link_transfer(a)

    def test_partners_must_share_a_budget(self):
        other = Budget.objects.create(created_by=self.user)
        other_cat = Category.objects.create(budget=other, name="X", category_type=Category.TYPE_EXPENSE)
        a = self.make_txn("100.00", category=self.expense_cat)
        stranger = Transaction.objects.create(
            budget=other, created_by=self.user, description="Stranger", due_date=MID_MONTH
        )
        TransactionLine.objects.create(
            transaction=stranger, category=other_cat, amount=Decimal("100.00"), amount_usd=Decimal("100.00")
        )
        with self.assertRaises(ValueError):
            a.link_transfer(stranger)


class TestFindTransferCandidates(TransferTestCase):
    def test_finds_the_opposite_direction_leg(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        incoming = self.make_txn("100.00", category=self.income_cat, pm=self.savings)
        self.assertEqual([c.pk for c in find_transfer_candidates(outgoing)], [incoming.pk])

    def test_same_direction_is_not_a_candidate(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        self.make_txn("100.00", category=self.expense_cat, pm=self.savings)
        self.assertEqual(find_transfer_candidates(outgoing), [])

    def test_a_different_amount_is_not_a_candidate(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        self.make_txn("100.01", category=self.income_cat, pm=self.savings)
        self.assertEqual(find_transfer_candidates(outgoing), [])

    def test_the_same_payment_method_is_excluded(self):
        """A transfer moves money between accounts, so both legs on one account is not one."""
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        self.make_txn("100.00", category=self.income_cat, pm=self.checking)
        self.assertEqual(find_transfer_candidates(outgoing), [])

    def test_an_already_linked_candidate_is_excluded(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        incoming = self.make_txn("100.00", category=self.income_cat, pm=self.savings)
        third = self.make_txn("100.00", category=self.expense_cat, pm=self.checking, description="Third")
        incoming.link_transfer(third)
        self.assertEqual(find_transfer_candidates(outgoing), [])

    def test_outside_the_day_window_is_excluded(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        self.make_txn(
            "100.00",
            category=self.income_cat,
            pm=self.savings,
            paid=MID_MONTH + datetime.timedelta(days=4),
        )
        self.assertEqual(find_transfer_candidates(outgoing), [])
        self.assertEqual(len(find_transfer_candidates(outgoing, day_window=4)), 1)

    def test_a_zero_amount_transaction_has_no_candidates(self):
        zero = self.make_txn("0.00", category=self.expense_cat, pm=self.checking)
        self.make_txn("0.00", category=self.income_cat, pm=self.savings)
        self.assertEqual(find_transfer_candidates(zero), [])

    def test_an_unsaved_transaction_has_no_candidates(self):
        self.assertEqual(find_transfer_candidates(Transaction()), [])

    def test_an_unpaid_candidate_is_matched_on_its_due_date(self):
        outgoing = self.make_txn("100.00", category=self.expense_cat, pm=self.checking)
        pending = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="Pending leg",
            due_date=MID_MONTH,
            paid_date=None,
            payment_method=self.savings,
        )
        TransactionLine.objects.create(
            transaction=pending, category=self.income_cat, amount=Decimal("100.00"), amount_usd=Decimal("100.00")
        )
        self.assertEqual([c.pk for c in find_transfer_candidates(outgoing)], [pending.pk])


class TestTransfersDoNotDistortTotals(TransferTestCase):
    """
    The headline numbers must ignore both legs of a linked transfer.

    Without this, moving $500 from checking to savings reads as $500 of income and $500 of
    spending, so Ready to Assign and every category total drift.
    """

    def _overview(self):
        return get_budget_overview(self.budget, MONTH.strftime("%Y-%m"))

    def test_baseline_income_counts_toward_ready_to_assign(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        overview = self._overview()
        self.assertEqual(Decimal(overview["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(overview["ready_to_assign"]), Decimal("1000.00"))

    def test_a_linked_transfer_does_not_change_income_or_ready_to_assign(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        before = self._overview()

        out_leg = self.make_txn(
            "500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking, description="To savings"
        )
        in_leg = self.make_txn(
            "500.00", category=self.income_cat, txn_type="transfer", pm=self.savings, description="From checking"
        )
        out_leg.link_transfer(in_leg)

        after = self._overview()
        self.assertEqual(after["income_total"], before["income_total"])
        self.assertEqual(after["ready_to_assign"], before["ready_to_assign"])

    def test_a_linked_transfer_does_not_register_as_category_spending(self):
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        CategoryBudget.objects.create(
            budget=self.budget, category=self.expense_cat, month=MONTH, assigned=Decimal("600.00")
        )
        out_leg = self.make_txn(
            "500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking, description="To savings"
        )
        in_leg = self.make_txn(
            "500.00", category=self.income_cat, txn_type="transfer", pm=self.savings, description="From checking"
        )
        out_leg.link_transfer(in_leg)

        row = next(r for r in self._overview()["categories"] if r["id"] == self.expense_cat.pk)
        self.assertEqual(Decimal(row["activity"]), Decimal("0.00"))
        self.assertEqual(Decimal(row["available"]), Decimal("600.00"))

    def test_transfer_typed_legs_are_excluded_by_type_even_when_unlinked(self):
        """
        Exclusion here comes from transaction_type, not the partner link.

        income_qs matches transaction_type="income" exactly and expense activity excludes
        "transfer" outright, so a transfer-typed leg never reaches either aggregate.
        """
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        self.make_txn("500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking)
        self.make_txn("500.00", category=self.income_cat, txn_type="transfer", pm=self.savings)
        self.assertEqual(Decimal(self._overview()["ready_to_assign"]), Decimal("1000.00"))

    def test_linking_is_what_excludes_legs_that_are_typed_income_and_expense(self):
        """
        The partner link is the second safety net, for legs typed as ordinary income/expense.

        Unlinked, an income-typed leg inflates Ready to Assign — which is exactly the
        double-count the link exists to prevent.
        """
        self.make_txn("1000.00", category=self.income_cat, txn_type="income", description="Paycheck")
        out_leg = self.make_txn(
            "500.00", category=self.expense_cat, txn_type="expense", pm=self.checking, description="To savings"
        )
        in_leg = self.make_txn(
            "500.00", category=self.income_cat, txn_type="income", pm=self.savings, description="From checking"
        )

        unlinked = self._overview()
        self.assertEqual(Decimal(unlinked["income_total"]), Decimal("1500.00"))

        out_leg.link_transfer(in_leg)
        linked = self._overview()
        self.assertEqual(Decimal(linked["income_total"]), Decimal("1000.00"))
        self.assertEqual(Decimal(linked["ready_to_assign"]), Decimal("1000.00"))

        out_leg.unlink_transfer()
        self.assertEqual(Decimal(self._overview()["income_total"]), Decimal("1500.00"))

    def test_deleting_one_leg_clears_the_survivors_pointer(self):
        out_leg = self.make_txn("500.00", category=self.expense_cat, txn_type="transfer", pm=self.checking)
        in_leg = self.make_txn("500.00", category=self.income_cat, txn_type="transfer", pm=self.savings)
        out_leg.link_transfer(in_leg)
        out_leg.delete()
        in_leg.refresh_from_db()
        self.assertIsNone(in_leg.transfer_partner_id)
