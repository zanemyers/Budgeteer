from decimal import Decimal

from django.test import SimpleTestCase

from apps.banking.models import BankAccount

# noinspection PyProtectedMember
from apps.investments.data import (
    _pct,
    _str,
    aggregate_holdings,
    serialize_holding,
    serialize_investment_account,
)
from apps.investments.models import Holding


class TestStr(SimpleTestCase):
    def test(self):
        self.assertEqual(_str(Decimal("1.50")), "1.50")
        self.assertIsNone(_str(None))


class TestPct(SimpleTestCase):
    def test_computes_percentage(self):
        self.assertEqual(_pct(Decimal("50"), Decimal("200")), 25.0)

    def test_none_when_not_computable(self):
        self.assertIsNone(_pct(None, Decimal("100")))
        self.assertIsNone(_pct(Decimal("5"), None))
        self.assertIsNone(_pct(Decimal("5"), Decimal("0")))
        self.assertIsNone(_pct(Decimal("5"), Decimal("-1")))


class TestUnrealizedGain(SimpleTestCase):
    def test_computes(self):
        self.assertEqual(Holding(market_value=Decimal("150"), cost_basis=Decimal("100")).unrealized_gain, Decimal("50"))

    def test_none_when_either_missing(self):
        self.assertIsNone(Holding(market_value=None, cost_basis=Decimal("100")).unrealized_gain)
        self.assertIsNone(Holding(market_value=Decimal("150"), cost_basis=None).unrealized_gain)


class TestSerializeHolding(SimpleTestCase):
    def test_fields_and_derived_values(self):
        h = Holding(
            symbol="AAPL",
            description="Apple",
            shares=Decimal("10"),
            cost_basis=Decimal("100"),
            market_value=Decimal("150"),
            purchase_price=Decimal("10"),
            currency="USD",
        )
        d = serialize_holding(h, account_market_value=Decimal("600"))
        self.assertEqual(d["symbol"], "AAPL")
        self.assertEqual(d["unrealized_gain"], "50")
        self.assertEqual(d["unrealized_gain_pct"], 50.0)  # 50 / 100
        self.assertEqual(d["weight_pct"], 25.0)  # 150 / 600
        self.assertNotIn("updated_at", d)  # trimmed from the payload

    def test_weight_none_without_account_total(self):
        h = Holding(symbol="X", shares=Decimal("1"), market_value=Decimal("10"))
        self.assertIsNone(serialize_holding(h)["weight_pct"])


class TestAggregateHoldings(SimpleTestCase):
    def test_totals(self):
        holdings = [
            Holding(market_value=Decimal("100"), cost_basis=Decimal("80")),
            Holding(market_value=Decimal("50"), cost_basis=Decimal("40")),
        ]
        agg = aggregate_holdings(holdings)
        self.assertEqual(agg["market_value"], "150")
        self.assertEqual(agg["cost_basis"], "120")
        self.assertEqual(agg["unrealized_gain"], "30")
        self.assertEqual(agg["unrealized_gain_pct"], 25.0)  # 30 / 120

    def test_empty(self):
        agg = aggregate_holdings([])
        self.assertEqual(agg["market_value"], "0")
        self.assertIsNone(agg["cost_basis"])
        self.assertIsNone(agg["unrealized_gain"])
        self.assertIsNone(agg["unrealized_gain_pct"])


class TestSerializeInvestmentAccount(SimpleTestCase):
    def test_totals_and_holdings(self):
        acct = BankAccount(name="Brokerage", org_name="Fidelity", org_domain="fidelity.com", currency="USD")
        holdings = [
            Holding(symbol="A", market_value=Decimal("100"), cost_basis=Decimal("80")),
            Holding(symbol="B", market_value=Decimal("100"), cost_basis=Decimal("120")),
        ]
        d = serialize_investment_account(acct, holdings)
        self.assertEqual(d["name"], "Brokerage")
        self.assertEqual(d["org_name"], "Fidelity")
        self.assertEqual(d["market_value"], "200")
        self.assertEqual(d["cost_basis"], "200")
        self.assertEqual(d["unrealized_gain"], "0")
        self.assertEqual(len(d["holdings"]), 2)
        self.assertEqual(d["holdings"][0]["weight_pct"], 50.0)  # 100 / 200
