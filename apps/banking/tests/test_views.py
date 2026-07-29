import json
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone

from inertia.test import InertiaTestCase

from apps.accounts.models import User
from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.budget.models import Budget, BudgetMembership, PaymentMethod


def _post_json(client, url, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json")


def _patch_json(client, url, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json")


class BankingViewTestCase(InertiaTestCase):
    def make_user(self, username="test.user"):
        return User.objects.create_user(username=username, email=f"{username}@example.com", password="password")  # noqa: S106


class TestBankingView(BankingViewTestCase):
    def test_requires_login(self):
        response = self.client.get(reverse("banking"))
        self.assertEqual(response.status_code, 302)

    def test_renders_connections_accounts_and_pending_counts(self):
        user = self.make_user()
        conn = SimpleFINConnection.objects.create(user=user, access_url="https://x/access", label="My Bank")
        acct = BankAccount.objects.create(connection=conn, simplefin_id="a1", name="Checking", org_name="Big Bank")
        BankTransaction.objects.create(
            bank_account=acct,
            simplefin_id="t1",
            posted_at=timezone.now(),
            amount="10.00",
            description="Coffee",
            status=BankTransaction.Status.PENDING,
        )
        self.client.force_login(user)
        self.client.get(reverse("banking"))

        self.assertComponentUsed("Banking")
        connections = self.props()["connections"]
        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["label"], "My Bank")
        accounts = connections[0]["accounts"]
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0]["name"], "Checking")
        self.assertEqual(accounts[0]["pending_count"], 1)
        self.assertEqual(len(accounts[0]["transactions"]), 1)

    def test_excludes_other_users_connections(self):
        user = self.make_user()
        other = self.make_user(username="other")
        SimpleFINConnection.objects.create(user=other, access_url="https://x/access", label="Other Bank")
        self.client.force_login(user)
        self.client.get(reverse("banking"))
        self.assertEqual(self.props()["connections"], [])

    def test_includes_users_payment_methods(self):
        user = self.make_user()
        budget = Budget.objects.create()
        BudgetMembership.objects.create(budget=budget, user=user, role="owner")
        PaymentMethod.objects.create(budget=budget, name="Visa", last_four="4242")
        self.client.force_login(user)
        self.client.get(reverse("banking"))

        payment_methods = self.props()["payment_methods"]
        self.assertEqual(len(payment_methods), 1)
        self.assertEqual(payment_methods[0]["name"], "Visa")
        self.assertEqual(payment_methods[0]["last_four"], "4242")


class TestBankingSync(BankingViewTestCase):
    def test_requires_authentication(self):
        response = _post_json(self.client, reverse("banking_sync"), {})
        self.assertEqual(response.status_code, 401)

    def test_queues_sync_for_all_connections(self):
        user = self.make_user()
        self.client.force_login(user)
        with patch("apps.banking.views.sync_simplefin.delay") as mock_delay:
            response = _post_json(self.client, reverse("banking_sync"), {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        mock_delay.assert_called_once_with()

    def test_queues_sync_for_single_connection(self):
        user = self.make_user()
        conn = SimpleFINConnection.objects.create(user=user, access_url="https://x", label="B")
        self.client.force_login(user)
        with patch("apps.banking.views.sync_simplefin.delay") as mock_delay:
            response = _post_json(self.client, reverse("banking_sync"), {"connection_id": conn.pk})
        self.assertEqual(response.status_code, 200)
        mock_delay.assert_called_once_with(connection_id=conn.pk)

    def test_rejects_another_users_connection(self):
        user = self.make_user()
        other = self.make_user(username="other")
        conn = SimpleFINConnection.objects.create(user=other, access_url="https://x", label="B")
        self.client.force_login(user)
        with patch("apps.banking.views.sync_simplefin.delay") as mock_delay:
            response = _post_json(self.client, reverse("banking_sync"), {"connection_id": conn.pk})
        self.assertEqual(response.status_code, 404)
        mock_delay.assert_not_called()


class TestBankAccountUpdateView(BankingViewTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="B")
        self.acct = BankAccount.objects.create(connection=self.conn, simplefin_id="a1", name="Checking")
        self.budget = Budget.objects.create()
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role="owner")
        self.pm = PaymentMethod.objects.create(budget=self.budget, name="Visa", last_four="4242")
        self.url = reverse("banking_account", kwargs={"pk": self.acct.pk})

    def test_requires_login(self):
        response = _patch_json(self.client, self.url, {"is_hidden": True})
        self.assertEqual(response.status_code, 302)

    def test_set_payment_method(self):
        self.client.force_login(self.user)
        response = _patch_json(self.client, self.url, {"payment_method_id": self.pm.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["payment_method_id"], self.pm.pk)
        self.acct.refresh_from_db()
        self.assertEqual(self.acct.payment_method_id, self.pm.pk)

    def test_clear_payment_method(self):
        self.acct.payment_method = self.pm
        self.acct.save()
        self.client.force_login(self.user)
        response = _patch_json(self.client, self.url, {"payment_method_id": None})
        self.assertEqual(response.status_code, 200)
        self.acct.refresh_from_db()
        self.assertIsNone(self.acct.payment_method_id)

    def test_hide_account(self):
        self.client.force_login(self.user)
        response = _patch_json(self.client, self.url, {"is_hidden": True})
        self.assertEqual(response.status_code, 200)
        self.acct.refresh_from_db()
        self.assertTrue(self.acct.is_hidden)

    def test_rejects_another_users_account(self):
        other = self.make_user(username="other")
        self.client.force_login(other)
        response = _patch_json(self.client, self.url, {"is_hidden": True})
        self.assertEqual(response.status_code, 404)

    def test_rejects_payment_method_from_foreign_budget(self):
        foreign_budget = Budget.objects.create()
        foreign_pm = PaymentMethod.objects.create(budget=foreign_budget, name="Foreign", last_four="0000")
        self.client.force_login(self.user)
        response = _patch_json(self.client, self.url, {"payment_method_id": foreign_pm.pk})
        self.assertEqual(response.status_code, 404)
        self.acct.refresh_from_db()
        self.assertIsNone(self.acct.payment_method_id)
