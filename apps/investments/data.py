from decimal import Decimal

from apps.investments.models import Holding


def _str(d: Decimal | None) -> str | None:
    return str(d) if d is not None else None


def _pct(numerator: Decimal | None, denominator: Decimal | None) -> float | None:
    """Percentage of numerator over denominator, or None when it can't be computed."""
    if numerator is None or not denominator or denominator <= 0:
        return None
    return float(numerator / denominator * 100)


def aggregate_holdings(holdings) -> dict:
    """Market/cost/gain(+%) totals over holdings — shared by the per-account block and portfolio summary."""
    market = sum((h.market_value for h in holdings if h.market_value is not None), Decimal("0"))
    cost = sum((h.cost_basis for h in holdings if h.cost_basis is not None), Decimal("0"))
    gain = market - cost if cost else None
    return {
        "market_value": _str(market),
        "cost_basis": _str(cost) if cost else None,
        "unrealized_gain": _str(gain),
        "unrealized_gain_pct": _pct(gain, cost),
    }


def serialize_holding(h: Holding, account_market_value: Decimal | None = None) -> dict:
    gain = h.unrealized_gain
    return {
        "id": h.pk,
        "symbol": h.symbol,
        "description": h.description,
        "shares": _str(h.shares),
        "cost_basis": _str(h.cost_basis),
        "market_value": _str(h.market_value),
        "purchase_price": _str(h.purchase_price),
        "currency": h.currency,
        "unrealized_gain": _str(gain),
        "unrealized_gain_pct": _pct(gain, h.cost_basis),
        "weight_pct": _pct(h.market_value, account_market_value),
    }


def serialize_investment_account(acct, holdings: list[Holding]) -> dict:
    market_total = sum((h.market_value for h in holdings if h.market_value is not None), Decimal("0"))
    return {
        "id": acct.pk,
        "name": acct.name,
        "org_name": acct.org_name,
        "org_domain": acct.org_domain,
        "currency": acct.currency,
        "balance": _str(acct.balance),
        "balance_as_of": acct.balance_as_of.isoformat() if acct.balance_as_of else None,
        **aggregate_holdings(holdings),
        "holdings": [serialize_holding(h, market_total) for h in holdings],
    }
