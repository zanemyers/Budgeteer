"""
Tests for InertiaShareMiddleware's flash handling.

This rail was silently dead: flash was shared *after* the response had been rendered, and
iterating get_messages() marked the storage used so MessageMiddleware then dropped it. Both
failure modes are invisible — the page renders fine, just without the message — so these
tests assert the message actually arrives.
"""

import datetime
from decimal import Decimal

from django.urls import reverse

from apps.base.tests import BaseTest
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    PaySchedule,
    Transaction,
    TransactionLine,
)

INERTIA_HEADERS = {"x-inertia": "true", "x-inertia-version": "1.0"}


class TestFlashMessages(BaseTest):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.budget = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.income_cat = Category.objects.create(budget=self.budget, name="Salary", category_type=Category.TYPE_INCOME)
        self.schedule = PaySchedule.objects.create(budget=self.budget, name="Acme", category=self.income_cat)
        # A generated paycheck placeholder with no amount: marking it paid is refused with a
        # message, which is the one real messages.* path that lands on an Inertia page.
        self.txn = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="Acme",
            due_date=datetime.date(2026, 5, 15),
            pay_schedule=self.schedule,
        )
        TransactionLine.objects.create(
            transaction=self.txn, category=self.income_cat, amount=Decimal("0.00"), amount_usd=Decimal("0.00")
        )
        self.client.force_login(self.user)
        self.mark_paid_url = reverse(
            "budget:transaction-mark-paid", kwargs={"budget_pk": self.budget.pk, "pk": self.txn.pk}
        )
        self.detail_url = reverse("budget:detail", kwargs={"budget_pk": self.budget.pk})

    def _trigger_message(self):
        res = self.client.post(self.mark_paid_url, headers={"x-inertia": "true"})
        self.assertEqual(res.status_code, 302)

    def test_message_reaches_the_next_page_as_a_flash_prop(self):
        self._trigger_message()
        props = self.client.get(self.detail_url, headers=INERTIA_HEADERS).json()["props"]
        self.assertIn("flash", props)
        self.assertEqual([m["level"] for m in props["flash"]], ["error"])
        self.assertIn("Set an amount", props["flash"][0]["message"])

    def test_flash_is_not_repeated_on_the_following_request(self):
        """Messages are consumed when delivered, so a later navigation must come back clean."""
        self._trigger_message()
        self.client.get(self.detail_url, headers=INERTIA_HEADERS)
        props = self.client.get(self.detail_url, headers=INERTIA_HEADERS).json()["props"]
        self.assertEqual(props.get("flash", []), [])

    def test_pages_with_no_messages_have_no_flash(self):
        props = self.client.get(self.detail_url, headers=INERTIA_HEADERS).json()["props"]
        self.assertEqual(props.get("flash", []), [])

    def test_admin_requests_do_not_consume_messages(self):
        """
        The admin renders messages through its own template.

        Consuming them in middleware would leave admin actions (e.g. the exchange-rate
        refresh) confirming with a blank page, so an intervening admin request must not
        swallow a pending message.
        """
        self._trigger_message()
        self.client.get("/admin/")  # redirects to admin login; the middleware still runs
        props = self.client.get(self.detail_url, headers=INERTIA_HEADERS).json()["props"]
        self.assertIn("Set an amount", props["flash"][0]["message"])
