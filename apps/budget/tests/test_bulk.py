"""
Tests for applying one change to many transactions.

The hazards are all about doing too much: acting on a transaction from another budget, destroying a
split by recategorising it, rewriting a date on something already paid, or leaving half a transfer
behind. Each has a test, because a bulk action is the one place where a small mistake is multiplied.
"""

import datetime
import json
from decimal import Decimal

from django.urls import reverse

from apps.base.tests import BaseTest
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    PaymentMethod,
    Transaction,
    TransactionLine,
)


class BulkTestCase(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user, name="Household")
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.groceries = Category.objects.create(
            budget=self.budget, name="Groceries", category_type=Category.TYPE_EXPENSE
        )
        self.eating_out = Category.objects.create(
            budget=self.budget, name="Eating Out", category_type=Category.TYPE_EXPENSE
        )
        self.salary = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.visa = PaymentMethod.objects.create(budget=self.budget, name="Visa")
        self.cash = PaymentMethod.objects.create(budget=self.budget, name="Cash")
        self.client.force_login(self.user)
        self.url = reverse("budget:transaction-bulk", kwargs={"budget_pk": self.budget.pk})

    def _txn(self, description, lines=None, paid=True, budget=None, **kwargs):
        target = budget or self.budget
        txn = Transaction.objects.create(
            budget=target,
            created_by=self.user,
            description=description,
            due_date=datetime.date(2026, 8, 4),
            paid_date=datetime.date(2026, 8, 4) if paid else None,
            **{"transaction_type": "expense", **kwargs},
        )
        for category, amount in lines or [(self.groceries, "10.00")]:
            TransactionLine.objects.create(
                transaction=txn, category=category, amount=Decimal(amount), amount_usd=Decimal(amount)
            )
        return txn

    def _post(self, **body):
        return self.client.post(self.url, data=json.dumps(body), content_type="application/json")


class TestBulkDelete(BulkTestCase):
    def test_it_deletes_everything_selected(self):
        a, b, c = self._txn("A"), self._txn("B"), self._txn("C")
        res = self._post(action="delete", ids=[a.pk, b.pk])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["changed"], 2)
        self.assertEqual([t.pk for t in Transaction.objects.all()], [c.pk])

    def test_a_transfer_takes_its_partner_with_it(self):
        """Half a transfer is a row pointing at nothing, so both sides go."""
        out_txn = self._txn("To savings", transaction_type="transfer")
        in_txn = self._txn("From checking", transaction_type="transfer")
        out_txn.link_transfer(in_txn)

        res = self._post(action="delete", ids=[out_txn.pk])
        self.assertEqual(res.json()["changed"], 2, "the partner was left behind")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_another_budgets_transaction_is_untouched(self):
        other = Budget.objects.create(created_by=self.user, name="Other")
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        stranger_cat = Category.objects.create(budget=other, name="Pets", category_type=Category.TYPE_EXPENSE)
        stranger = self._txn("Elsewhere", lines=[(stranger_cat, "10.00")], budget=other)
        mine = self._txn("Mine")

        res = self._post(action="delete", ids=[mine.pk, stranger.pk])
        self.assertEqual(res.json()["changed"], 1, "it reached outside the budget")
        self.assertTrue(Transaction.objects.filter(pk=stranger.pk).exists())


class TestBulkCategory(BulkTestCase):
    def test_it_moves_every_selected_transaction(self):
        a, b = self._txn("A"), self._txn("B")
        res = self._post(action="category", ids=[a.pk, b.pk], category=self.eating_out.pk)
        self.assertEqual(res.json()["changed"], 2)
        for txn in (a, b):
            self.assertEqual(txn.lines.get().category, self.eating_out)

    def test_a_split_is_left_alone_and_reported(self):
        """
        Recategorising a split would mean choosing which of its parts to destroy.

        Silently collapsing it to one line is the version of this that loses data, so it is skipped
        and named instead — and the changed count never claims it.
        """
        split = self._txn("Costco", lines=[(self.groceries, "40.00"), (self.eating_out, "20.00")])
        simple = self._txn("Aldi")

        res = self._post(action="category", ids=[split.pk, simple.pk], category=self.eating_out.pk)
        body = res.json()
        self.assertEqual(body["changed"], 1)
        self.assertEqual(body["skipped"], [{"id": split.pk, "reason": "split across several categories"}])
        self.assertEqual(split.lines.count(), 2, "the split was flattened")

    def test_moving_to_an_income_category_rederives_the_type(self):
        """transaction_type follows the first line's category, so it has to be recomputed."""
        txn = self._txn("Refund")
        self._post(action="category", ids=[txn.pk], category=self.salary.pk)
        txn.refresh_from_db()
        self.assertEqual(txn.transaction_type, "income")

    def test_a_category_from_another_budget_is_refused(self):
        other = Budget.objects.create(created_by=self.user, name="Other")
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        stranger_cat = Category.objects.create(budget=other, name="Pets", category_type=Category.TYPE_EXPENSE)
        txn = self._txn("A")

        res = self._post(action="category", ids=[txn.pk], category=stranger_cat.pk)
        self.assertEqual(res.status_code, 404)
        self.assertEqual(txn.lines.get().category, self.groceries)


class TestBulkPaymentMethod(BulkTestCase):
    def test_it_sets_the_method_on_everything_selected(self):
        a, b = self._txn("A", payment_method=self.visa), self._txn("B")
        self._post(action="payment_method", ids=[a.pk, b.pk], payment_method=self.cash.pk)
        for txn in (a, b):
            txn.refresh_from_db()
            self.assertEqual(txn.payment_method, self.cash)

    def test_it_can_clear_the_method(self):
        txn = self._txn("A", payment_method=self.visa)
        self._post(action="payment_method", ids=[txn.pk], payment_method=None)
        txn.refresh_from_db()
        self.assertIsNone(txn.payment_method)

    def test_a_method_from_another_budget_is_refused(self):
        other = Budget.objects.create(created_by=self.user, name="Other")
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        stranger_pm = PaymentMethod.objects.create(budget=other, name="Theirs")
        txn = self._txn("A", payment_method=self.visa)

        res = self._post(action="payment_method", ids=[txn.pk], payment_method=stranger_pm.pk)
        self.assertEqual(res.status_code, 404)
        txn.refresh_from_db()
        self.assertEqual(txn.payment_method, self.visa)


class TestBulkPaidState(BulkTestCase):
    def test_marking_paid_stamps_todays_local_date(self):
        txn = self._txn("A", paid=False)
        self._post(action="mark_paid", ids=[txn.pk])
        txn.refresh_from_db()
        from django.utils import timezone

        self.assertEqual(txn.paid_date, timezone.localdate())

    def test_something_already_paid_keeps_its_date(self):
        """A stray selection must not rewrite the date on history."""
        already = self._txn("Old")
        original = already.paid_date
        unpaid = self._txn("New", paid=False)

        body = self._post(action="mark_paid", ids=[already.pk, unpaid.pk]).json()
        already.refresh_from_db()
        self.assertEqual(already.paid_date, original)
        self.assertEqual(body["changed"], 1)
        self.assertEqual(body["skipped"], [{"id": already.pk, "reason": "already paid"}])

    def test_marking_unpaid_clears_the_date(self):
        txn = self._txn("A")
        self._post(action="mark_unpaid", ids=[txn.pk])
        txn.refresh_from_db()
        self.assertIsNone(txn.paid_date)


class TestBulkValidation(BulkTestCase):
    def test_an_unknown_action_is_refused(self):
        txn = self._txn("A")
        res = self._post(action="explode", ids=[txn.pk])
        self.assertEqual(res.status_code, 400)
        self.assertIn("action", res.json()["errors"])
        self.assertTrue(Transaction.objects.filter(pk=txn.pk).exists())

    def test_an_empty_selection_is_refused(self):
        for ids in ([], None, "all"):
            with self.subTest(ids=ids):
                res = self._post(action="delete", ids=ids)
                self.assertEqual(res.status_code, 400)
                self.assertIn("ids", res.json()["errors"])

    def test_non_integer_ids_do_not_reach_the_database(self):
        """A string id would otherwise raise on the pk lookup rather than being rejected."""
        res = self._post(action="delete", ids=["1; DROP TABLE", None, {}])
        self.assertEqual(res.status_code, 400)
        self.assertIn("ids", res.json()["errors"])

    def test_ids_belonging_to_nobody_are_refused_rather_than_reported_as_changed(self):
        res = self._post(action="delete", ids=[999_999])
        self.assertEqual(res.status_code, 400)

    def test_someone_elses_budget_cannot_be_bulk_edited(self):
        from apps.accounts.models import User

        stranger = User.objects.create_user(username="other", email="o@example.com", password="pw")  # noqa: S106
        other = Budget.objects.create(created_by=stranger)
        BudgetMembership.objects.create(budget=other, user=stranger, role=BudgetMembership.ROLE_OWNER)
        url = reverse("budget:transaction-bulk", kwargs={"budget_pk": other.pk})
        res = self.client.post(url, data=json.dumps({"action": "delete", "ids": [1]}), content_type="application/json")
        self.assertEqual(res.status_code, 404)
