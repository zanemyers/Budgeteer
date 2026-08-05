"""
Tests for the bank-row to ledger-entry matcher.

apps/budget/bank_matching.py decides which bank row maps onto which ledger entry. This is a
silent-wrong-answer path: a bad suggestion the user accepts doesn't raise, it just quietly
files money against the wrong transaction.
"""

import datetime
from decimal import Decimal

from django.utils import timezone

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.base.tests import BaseTest
from apps.budget.bank_matching import (
    AMOUNT_TOLERANCE,
    DATE_WINDOW_DAYS,
    MAX_SUGGESTIONS,
    suggest_matches,
)
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    PaymentMethod,
    RecurringTransaction,
    Transaction,
    TransactionLine,
)

POSTED = datetime.datetime(2026, 3, 10, 12, 0, tzinfo=datetime.UTC)


class BankMatchingTestCase(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.expense_cat = Category.objects.create(
            budget=self.budget, name="Groceries", category_type=Category.TYPE_EXPENSE
        )
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.pm = PaymentMethod.objects.create(budget=self.budget, name="Checking")
        self.connection = SimpleFINConnection.objects.create(user=self.user, access_url="https://example.invalid/x")
        self.account = BankAccount.objects.create(
            connection=self.connection,
            simplefin_id="acct-1",
            name="Checking",
            payment_method=self.pm,
        )

    def bank_txn(self, amount, *, payee="", description="", posted=POSTED, status=BankTransaction.Status.PENDING):
        return BankTransaction.objects.create(
            bank_account=self.account,
            simplefin_id=f"bt-{BankTransaction.objects.count() + 1}",
            posted_at=posted,
            amount=Decimal(amount),
            payee=payee,
            description=description,
            status=status,
        )

    def txn(self, amount, *, category=None, due=None, paid=None, description="Thing", pm=None, recurring=None):
        t = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description=description,
            due_date=due or POSTED.date(),
            paid_date=paid,
            payment_method=pm,
            recurring=recurring,
        )
        TransactionLine.objects.create(
            transaction=t,
            category=category or self.expense_cat,
            amount=Decimal(amount),
            amount_usd=Decimal(amount),
        )
        return t


class TestDirectionMatching(BankMatchingTestCase):
    """
    Guard the sign of the movement.

    _amount_matches compares magnitudes, so without a direction check a +$50 deposit and a
    $50 card charge look identical. Accepting that suggestion would book a grocery charge
    against a paycheck.
    """

    def test_outflow_does_not_match_an_income_transaction(self):
        self.txn("50.00", category=self.income_cat, description="Paycheck")
        suggestions = suggest_matches(self.bank_txn("-50.00", payee="Paycheck"), self.budget)
        self.assertEqual([s for s in suggestions if s["kind"] != "merchant_rule"], [])

    def test_inflow_does_not_match_an_expense_transaction(self):
        self.txn("50.00", category=self.expense_cat, description="Groceries")
        suggestions = suggest_matches(self.bank_txn("50.00", payee="Groceries"), self.budget)
        self.assertEqual([s for s in suggestions if s["kind"] != "merchant_rule"], [])

    def test_outflow_matches_an_expense_transaction(self):
        expected = self.txn("50.00", category=self.expense_cat, description="Groceries")
        suggestions = suggest_matches(self.bank_txn("-50.00", payee="Groceries"), self.budget)
        self.assertEqual([s["transaction_id"] for s in suggestions], [expected.pk])

    def test_inflow_matches_an_income_transaction(self):
        expected = self.txn("50.00", category=self.income_cat, description="Paycheck")
        suggestions = suggest_matches(self.bank_txn("50.00", payee="Paycheck"), self.budget)
        self.assertEqual([s["transaction_id"] for s in suggestions], [expected.pk])

    def test_transfers_are_matchable_in_either_direction(self):
        """A transfer has a leg in each direction, so direction must not exclude it."""
        for bank_amount in ("-50.00", "50.00"):
            with self.subTest(bank_amount=bank_amount):
                Transaction.objects.all().delete()
                t = self.txn("50.00", description="Move to savings")
                t.transaction_type = "transfer"
                t.save(update_fields=["transaction_type"])
                suggestions = suggest_matches(self.bank_txn(bank_amount, payee="Move to savings"), self.budget)
                self.assertIn(t.pk, [s["transaction_id"] for s in suggestions])


class TestAmountMatching(BankMatchingTestCase):
    def test_amount_within_tolerance_matches(self):
        expected = self.txn("50.00", description="Groceries")
        bt = self.bank_txn(Decimal("-50.00") - AMOUNT_TOLERANCE, payee="Groceries")
        self.assertEqual([s["transaction_id"] for s in suggest_matches(bt, self.budget)], [expected.pk])

    def test_amount_outside_tolerance_does_not_match(self):
        self.txn("50.00", description="Groceries")
        bt = self.bank_txn("-50.50", payee="Groceries")
        self.assertEqual([s for s in suggest_matches(bt, self.budget) if s["kind"] != "merchant_rule"], [])

    def test_transaction_with_no_lines_has_zero_total_and_does_not_match(self):
        Transaction.objects.create(
            budget=self.budget, created_by=self.user, description="Empty", due_date=POSTED.date()
        )
        bt = self.bank_txn("-50.00", payee="Empty")
        self.assertEqual([s for s in suggest_matches(bt, self.budget) if s["kind"] != "merchant_rule"], [])

    def test_split_transaction_matches_on_the_sum_of_its_lines(self):
        t = Transaction.objects.create(
            budget=self.budget, created_by=self.user, description="Costco run", due_date=POSTED.date()
        )
        for amount in ("30.00", "20.00"):
            TransactionLine.objects.create(
                transaction=t, category=self.expense_cat, amount=Decimal(amount), amount_usd=Decimal(amount)
            )
        bt = self.bank_txn("-50.00", payee="Costco run")
        self.assertEqual([s["transaction_id"] for s in suggest_matches(bt, self.budget)], [t.pk])


class TestDateWindow(BankMatchingTestCase):
    def test_candidate_at_the_window_edge_still_matches(self):
        due = POSTED.date() + datetime.timedelta(days=DATE_WINDOW_DAYS)
        expected = self.txn("50.00", due=due, description="Groceries")
        bt = self.bank_txn("-50.00", payee="Groceries")
        self.assertEqual([s["transaction_id"] for s in suggest_matches(bt, self.budget)], [expected.pk])

    def test_candidate_beyond_the_window_does_not_match(self):
        due = POSTED.date() + datetime.timedelta(days=DATE_WINDOW_DAYS + 1)
        self.txn("50.00", due=due, description="Groceries")
        bt = self.bank_txn("-50.00", payee="Groceries")
        self.assertEqual([s for s in suggest_matches(bt, self.budget) if s["kind"] != "merchant_rule"], [])

    def test_same_day_outranks_a_more_distant_candidate(self):
        near = self.txn("50.00", due=POSTED.date(), description="Groceries")
        self.txn("50.00", due=POSTED.date() + datetime.timedelta(days=5), description="Groceries")
        bt = self.bank_txn("-50.00", payee="Groceries")
        ranked = [s["transaction_id"] for s in suggest_matches(bt, self.budget)]
        self.assertEqual(ranked[0], near.pk)


class TestPaidTransactionMatching(BankMatchingTestCase):
    """Covers the enter-as-you-spend flow: a paid manual entry the bank confirms later."""

    def test_already_paid_transaction_is_offered(self):
        paid = self.txn("50.00", paid=POSTED.date(), description="Groceries")
        bt = self.bank_txn("-50.00", payee="Groceries")
        suggestions = suggest_matches(bt, self.budget)
        self.assertEqual([s["kind"] for s in suggestions if s["transaction_id"] == paid.pk], ["paid_transaction"])

    def test_a_paid_transaction_already_bank_linked_is_not_offered_again(self):
        paid = self.txn("50.00", paid=POSTED.date(), description="Groceries")
        self.bank_txn("-50.00", payee="Groceries", status=BankTransaction.Status.LINKED).transaction = paid
        already = BankTransaction.objects.get(status=BankTransaction.Status.LINKED)
        already.transaction = paid
        already.save(update_fields=["transaction"])

        bt = self.bank_txn("-50.00", payee="Groceries")
        ids = [s["transaction_id"] for s in suggest_matches(bt, self.budget)]
        self.assertNotIn(paid.pk, ids)


class TestScoringAndShape(BankMatchingTestCase):
    def test_payment_method_agreement_raises_confidence(self):
        other_pm = PaymentMethod.objects.create(budget=self.budget, name="Other card")
        matching = self.txn("50.00", description="Groceries", pm=self.pm)
        self.txn("50.00", description="Groceries", pm=other_pm)
        bt = self.bank_txn("-50.00", payee="Groceries")
        suggestions = suggest_matches(bt, self.budget)
        self.assertEqual(suggestions[0]["transaction_id"], matching.pk)

    def test_recurring_instances_are_labelled_by_schedule_name(self):
        rt = RecurringTransaction.objects.create(
            budget=self.budget,
            category=self.expense_cat,
            created_by=self.user,
            name="Netflix",
            amount=Decimal("50.00"),
            frequency=RecurringTransaction.FREQ_MONTHLY,
            start_date=POSTED.date(),
        )
        self.txn("50.00", description="whatever", recurring=rt)
        bt = self.bank_txn("-50.00", payee="Netflix")
        top = suggest_matches(bt, self.budget)[0]
        self.assertEqual(top["kind"], "recurring")
        self.assertEqual(top["label"], "Netflix")

    def test_confidence_is_bounded_and_results_are_ranked(self):
        for i in range(6):
            self.txn("50.00", due=POSTED.date() + datetime.timedelta(days=i), description="Groceries")
        suggestions = suggest_matches(self.bank_txn("-50.00", payee="Groceries"), self.budget)
        self.assertLessEqual(len(suggestions), MAX_SUGGESTIONS)
        confidences = [s["confidence"] for s in suggestions]
        self.assertEqual(confidences, sorted(confidences, reverse=True))
        for c in confidences:
            self.assertGreaterEqual(c, 0.0)
            self.assertLessEqual(c, 1.0)

    def test_a_transaction_is_never_suggested_twice(self):
        """A transaction paid and due in the window could be picked up by both passes."""
        t = self.txn("50.00", due=POSTED.date(), paid=POSTED.date(), description="Groceries")
        ids = [s["transaction_id"] for s in suggest_matches(self.bank_txn("-50.00", payee="Groceries"), self.budget)]
        self.assertEqual(ids.count(t.pk), 1)

    def test_other_budgets_are_never_suggested(self):
        other_budget = Budget.objects.create(created_by=self.user)
        other_cat = Category.objects.create(budget=other_budget, name="Groceries", category_type=Category.TYPE_EXPENSE)
        stranger = Transaction.objects.create(
            budget=other_budget, created_by=self.user, description="Groceries", due_date=POSTED.date()
        )
        TransactionLine.objects.create(
            transaction=stranger, category=other_cat, amount=Decimal("50.00"), amount_usd=Decimal("50.00")
        )
        ids = [s["transaction_id"] for s in suggest_matches(self.bank_txn("-50.00", payee="Groceries"), self.budget)]
        self.assertNotIn(stranger.pk, ids)


class TestMerchantRule(BankMatchingTestCase):
    def test_a_similar_past_link_proposes_its_category(self):
        past_txn = self.txn("22.00", paid=POSTED.date() - datetime.timedelta(days=30), description="WHOLE FOODS")
        linked = self.bank_txn(
            "-22.00",
            payee="WHOLE FOODS MARKET",
            posted=POSTED - datetime.timedelta(days=30),
            status=BankTransaction.Status.LINKED,
        )
        linked.transaction = past_txn
        linked.save(update_fields=["transaction"])

        bt = self.bank_txn("-31.00", payee="WHOLE FOODS MARKET")
        rules = [s for s in suggest_matches(bt, self.budget) if s["kind"] == "merchant_rule"]
        self.assertEqual([r["category_id"] for r in rules], [self.expense_cat.pk])
        self.assertEqual(rules[0]["payment_method_id"], self.pm.pk)

    def test_a_dissimilar_past_link_proposes_nothing(self):
        past_txn = self.txn("22.00", paid=POSTED.date() - datetime.timedelta(days=30), description="SHELL")
        linked = self.bank_txn(
            "-22.00",
            payee="SHELL OIL 4412",
            posted=POSTED - datetime.timedelta(days=30),
            status=BankTransaction.Status.LINKED,
        )
        linked.transaction = past_txn
        linked.save(update_fields=["transaction"])

        bt = self.bank_txn("-31.00", payee="WHOLE FOODS MARKET")
        self.assertEqual([s for s in suggest_matches(bt, self.budget) if s["kind"] == "merchant_rule"], [])

    def test_another_users_history_is_not_consulted(self):
        stranger = self.make_user(username="stranger")
        stranger_conn = SimpleFINConnection.objects.create(user=stranger, access_url="https://example.invalid/y")
        stranger_acct = BankAccount.objects.create(
            connection=stranger_conn, simplefin_id="acct-9", name="Theirs", payment_method=self.pm
        )
        past_txn = self.txn("22.00", paid=POSTED.date() - datetime.timedelta(days=30), description="WHOLE FOODS")
        BankTransaction.objects.create(
            bank_account=stranger_acct,
            simplefin_id="bt-stranger",
            posted_at=POSTED - datetime.timedelta(days=30),
            amount=Decimal("-22.00"),
            payee="WHOLE FOODS MARKET",
            status=BankTransaction.Status.LINKED,
            transaction=past_txn,
        )
        bt = self.bank_txn("-31.00", payee="WHOLE FOODS MARKET")
        self.assertEqual([s for s in suggest_matches(bt, self.budget) if s["kind"] == "merchant_rule"], [])


class TestNoCandidates(BankMatchingTestCase):
    def test_empty_budget_yields_no_suggestions(self):
        self.assertEqual(suggest_matches(self.bank_txn("-50.00", payee="Groceries"), self.budget), [])

    def test_naive_vs_aware_posted_at_uses_the_date(self):
        """posted_at is a datetime; the matcher must compare on its date only."""
        expected = self.txn("50.00", due=timezone.localdate(), description="Groceries")
        bt = self.bank_txn(
            "-50.00",
            payee="Groceries",
            posted=timezone.make_aware(
                datetime.datetime.combine(timezone.localdate(), datetime.time(23, 59)),
                datetime.UTC,
            ),
        )
        self.assertIn(expected.pk, [s["transaction_id"] for s in suggest_matches(bt, self.budget)])
