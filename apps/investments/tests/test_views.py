from decimal import Decimal

from django.urls import reverse

from inertia.test import InertiaTestCase

from apps.accounts.models import User
from apps.banking.models import BankAccount, SimpleFINConnection
from apps.investments.models import Holding


class InvestmentsViewTestCase(InertiaTestCase):
    def make_user(self, username="testuser"):
        return User.objects.create_user(username=username, email=f"{username}@example.com", password="password")  # noqa: S106

    def add_account(self, user, org_name="Fidelity", name="Brokerage"):
        conn = SimpleFINConnection.objects.create(user=user, access_url="https://x", label="B")
        return BankAccount.objects.create(
            connection=conn, simplefin_id=f"a-{org_name}-{name}", name=name, org_name=org_name
        )


class TestInvestmentsView(InvestmentsViewTestCase):
    def test_requires_login(self):
        self.assertEqual(self.client.get(reverse("investments")).status_code, 302)

    def test_renders_accounts_and_portfolio(self):
        user = self.make_user()
        acct = self.add_account(user)
        Holding.objects.create(
            bank_account=acct,
            simplefin_id="H1",
            symbol="AAPL",
            shares=Decimal("10"),
            cost_basis=Decimal("1000"),
            market_value=Decimal("1500"),
        )
        Holding.objects.create(
            bank_account=acct,
            simplefin_id="H2",
            symbol="MSFT",
            shares=Decimal("5"),
            cost_basis=Decimal("500"),
            market_value=Decimal("400"),
        )
        self.client.force_login(user)
        self.client.get(reverse("investments"))

        self.assertComponentUsed("Investments")
        props = self.props()
        self.assertEqual(len(props["accounts"]), 1)
        self.assertEqual(len(props["accounts"][0]["holdings"]), 2)
        self.assertEqual(props["portfolio"]["market_value"], "1900.00")
        self.assertEqual(props["portfolio"]["cost_basis"], "1500.00")
        self.assertEqual(props["portfolio"]["unrealized_gain"], "400.00")

    def test_excludes_other_users_holdings(self):
        user = self.make_user()
        other = self.make_user(username="other")
        acct = self.add_account(other)
        Holding.objects.create(bank_account=acct, simplefin_id="H1", symbol="AAPL", market_value=Decimal("100"))
        self.client.force_login(user)
        self.client.get(reverse("investments"))
        self.assertEqual(self.props()["accounts"], [])
        self.assertEqual(self.props()["portfolio"]["market_value"], "0")

    def test_accounts_ordered_by_org_then_name(self):
        user = self.make_user()
        zebra = self.add_account(user, org_name="Zebra", name="Z")
        alpha = self.add_account(user, org_name="Alpha", name="A")
        Holding.objects.create(bank_account=zebra, simplefin_id="HZ", symbol="Z", market_value=Decimal("1"))
        Holding.objects.create(bank_account=alpha, simplefin_id="HA", symbol="A", market_value=Decimal("1"))
        self.client.force_login(user)
        self.client.get(reverse("investments"))
        self.assertEqual([a["org_name"] for a in self.props()["accounts"]], ["Alpha", "Zebra"])
