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


class TransactionSearchTests(TransactionFilterTests):
    """
    Search has to reach across months, which is the whole point of it.

    TransactionListView filtered on month, category, method and date and nothing else, so
    answering "when did I last pay the vet?" meant paging back a month at a time. A search
    confined to the month on screen would not have replaced that.
    """

    def _named(self, description, year, month, day, notes=""):
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description=description,
            notes=notes,
            due_date=datetime.date(year, month, day),
            paid_date=datetime.date(year, month, day),
            transaction_type="expense",
            payment_method=self.pm_a,
        )
        TransactionLine.objects.create(transaction=txn, category=self.cat, amount="10.00", amount_usd="10.00")
        return txn

    def test_search_finds_a_match_outside_the_requested_month(self):
        old = self._named("Village Vet Clinic", 2026, 2, 11)
        self._named("Groceries", 2026, 7, 3)

        ids = self._ids("?month=2026-07&q=vet")
        self.assertIn(old.pk, ids, "a February match was invisible from July")

    def test_search_is_case_insensitive_and_matches_partial_words(self):
        txn = self._named("Village Vet Clinic", 2026, 2, 11)
        for term in ("vet", "VET", "illage", "clinic"):
            with self.subTest(term=term):
                self.assertIn(txn.pk, self._ids(f"?month=2026-07&q={term}"))

    def test_search_matches_notes_and_line_descriptions(self):
        by_note = self._named("Card payment", 2026, 3, 4, notes="annual vet checkup")
        by_line = self._named("Card payment", 2026, 4, 4)
        by_line.lines.update(description="Vet co-pay")

        ids = self._ids("?month=2026-07&q=vet")
        self.assertIn(by_note.pk, ids)
        self.assertIn(by_line.pk, ids)

    def test_a_match_is_returned_once_even_when_several_fields_hit(self):
        txn = self._named("Vet visit", 2026, 5, 6, notes="vet again")
        txn.lines.update(description="vet")

        ids = self._ids("?month=2026-07&q=vet")
        self.assertEqual(ids.count(txn.pk), 1, "joining across lines duplicated the row")

    def test_no_search_still_restricts_to_the_month(self):
        self._named("Village Vet Clinic", 2026, 2, 11)
        july = self._named("Groceries", 2026, 7, 3)

        ids = self._ids("?month=2026-07")
        self.assertEqual(ids, [july.pk], "an absent search must not widen the window")

    def test_a_date_range_still_narrows_a_search(self):
        """An explicit range is the user asking for a window, so it outranks the widening."""
        feb = self._named("Vet", 2026, 2, 11)
        june = self._named("Vet", 2026, 6, 11)

        ids = self._ids("?month=2026-07&q=vet&date_from=2026-05-01&date_to=2026-07-31")
        self.assertIn(june.pk, ids)
        self.assertNotIn(feb.pk, ids)

    def test_search_is_scoped_to_this_budget(self):
        other_budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=other_budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        other_cat = Category.objects.create(budget=other_budget, name="Pets", category_type=Category.TYPE_EXPENSE)
        stranger = Transaction.objects.create(
            budget=other_budget,
            created_by=self.user,
            description="Vet elsewhere",
            due_date=datetime.date(2026, 2, 11),
            paid_date=datetime.date(2026, 2, 11),
            transaction_type="expense",
        )
        TransactionLine.objects.create(transaction=stranger, category=other_cat, amount="10.00", amount_usd="10.00")

        self.assertNotIn(stranger.pk, self._ids("?month=2026-07&q=vet"))

    def test_whitespace_only_search_is_treated_as_no_search(self):
        self._named("Village Vet Clinic", 2026, 2, 11)
        july = self._named("Groceries", 2026, 7, 3)

        self.assertEqual(self._ids("?month=2026-07&q=%20%20"), [july.pk])
