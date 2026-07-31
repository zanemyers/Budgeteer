import datetime

from django.urls import reverse

from inertia.test import InertiaTestCase

from apps.accounts.models import User
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    PaymentMethod,
    Transaction,
    TransactionLine,
)


class TransactionFilterTests(InertiaTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.cat = Category.objects.create(budget=self.budget, name="Food", category_type=Category.TYPE_EXPENSE)
        self.pm_a = PaymentMethod.objects.create(budget=self.budget, name="Visa")
        self.pm_b = PaymentMethod.objects.create(budget=self.budget, name="Cash")
        self.client.force_login(self.user)

    def _txn(self, day, pm):
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description=f"txn-{day}",
            due_date=datetime.date(2026, 7, day),
            paid_date=datetime.date(2026, 7, day),
            transaction_type="expense",
            payment_method=pm,
        )
        TransactionLine.objects.create(transaction=txn, category=self.cat, amount="10.00", amount_usd="10.00")
        return txn

    def _ids(self, query):
        url = reverse("budget:transaction-list", kwargs={"budget_pk": self.budget.pk})
        self.client.get(url + query)
        return [t["id"] for t in self.props()["transactions"]]

    def test_filter_by_payment_method(self):
        a = self._txn(5, self.pm_a)
        b = self._txn(6, self.pm_b)
        ids = self._ids(f"?month=2026-07&method={self.pm_a.pk}")
        self.assertIn(a.pk, ids)
        self.assertNotIn(b.pk, ids)

    def test_filter_by_date_range(self):
        early = self._txn(5, self.pm_a)
        late = self._txn(20, self.pm_a)
        ids = self._ids("?month=2026-07&date_from=2026-07-10&date_to=2026-07-31")
        self.assertIn(late.pk, ids)
        self.assertNotIn(early.pk, ids)

    def test_filters_combine(self):
        match = self._txn(20, self.pm_a)
        wrong_method = self._txn(20, self.pm_b)
        wrong_date = self._txn(5, self.pm_a)
        ids = self._ids(f"?month=2026-07&method={self.pm_a.pk}&date_from=2026-07-10")
        self.assertEqual(ids, [match.pk])
        self.assertNotIn(wrong_method.pk, ids)
        self.assertNotIn(wrong_date.pk, ids)

    def test_no_filters_returns_all_in_month(self):
        a = self._txn(5, self.pm_a)
        b = self._txn(20, self.pm_b)
        ids = self._ids("?month=2026-07")
        self.assertCountEqual(ids, [a.pk, b.pk])
