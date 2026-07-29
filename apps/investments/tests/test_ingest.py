from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from apps.accounts.models import User
from apps.banking.models import BankAccount, SimpleFINConnection

# noinspection PyProtectedMember
from apps.investments.ingest import _to_decimal, persist_holdings
from apps.investments.models import Holding


class TestToDecimal(SimpleTestCase):
    def test_parses_numbers(self):
        self.assertEqual(_to_decimal("12.34"), Decimal("12.34"))
        self.assertEqual(_to_decimal(5), Decimal("5"))

    def test_missing_returns_default(self):
        self.assertIsNone(_to_decimal(None))
        self.assertIsNone(_to_decimal(""))
        self.assertEqual(_to_decimal(None, Decimal("0")), Decimal("0"))

    def test_garbage_returns_default(self):
        self.assertIsNone(_to_decimal("not a number"))
        self.assertEqual(_to_decimal("not a number", Decimal("0")), Decimal("0"))


class TestPersistHoldings(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="B")
        self.acct = BankAccount.objects.create(connection=self.conn, simplefin_id="a1", name="Brokerage")

    def _payload(self, **overrides):
        base = {
            "id": "H1",
            "symbol": "AAPL",
            "description": "Apple Inc",
            "shares": "10",
            "cost_basis": "1000.00",
            "market_value": "1500.00",
            "purchase_price": "100.00",
            "currency": "USD",
        }
        base.update(overrides)
        return base

    def test_creates_holdings(self):
        summary = persist_holdings(self.acct, [self._payload()])
        self.assertEqual(summary, {"new": 1, "updated": 0, "removed": 0})
        h = Holding.objects.get(bank_account=self.acct, simplefin_id="H1")
        self.assertEqual(h.symbol, "AAPL")
        self.assertEqual(h.shares, Decimal("10"))
        self.assertEqual(h.cost_basis, Decimal("1000.00"))
        self.assertEqual(h.market_value, Decimal("1500.00"))
        self.assertEqual(h.raw["symbol"], "AAPL")

    def test_second_sync_updates_not_duplicates(self):
        persist_holdings(self.acct, [self._payload()])
        summary = persist_holdings(self.acct, [self._payload(market_value="1600.00")])
        self.assertEqual(summary, {"new": 0, "updated": 1, "removed": 0})
        self.assertEqual(Holding.objects.count(), 1)
        self.assertEqual(Holding.objects.get(simplefin_id="H1").market_value, Decimal("1600.00"))

    def test_removes_holdings_absent_from_payload(self):
        persist_holdings(self.acct, [self._payload(), self._payload(id="H2", symbol="MSFT")])
        summary = persist_holdings(self.acct, [self._payload()])
        self.assertEqual(summary["removed"], 1)
        self.assertFalse(Holding.objects.filter(simplefin_id="H2").exists())
        self.assertTrue(Holding.objects.filter(simplefin_id="H1").exists())

    def test_skips_entries_without_id(self):
        summary = persist_holdings(self.acct, [self._payload(id=""), self._payload(id=None)])
        self.assertEqual(summary["new"], 0)
        self.assertEqual(Holding.objects.count(), 0)

    def test_none_payload_is_noop(self):
        persist_holdings(self.acct, [self._payload()])
        summary = persist_holdings(self.acct, None)
        self.assertEqual(summary, {"new": 0, "updated": 0, "removed": 0})
        self.assertEqual(Holding.objects.count(), 1)

    def test_missing_numeric_fields_default_sensibly(self):
        persist_holdings(self.acct, [{"id": "H3", "symbol": "X"}])
        h = Holding.objects.get(simplefin_id="H3")
        self.assertEqual(h.shares, Decimal("0"))
        self.assertIsNone(h.cost_basis)
        self.assertIsNone(h.market_value)
