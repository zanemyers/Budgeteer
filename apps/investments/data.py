from decimal import Decimal

from apps.investments.models import Holding


def _str(d: Decimal | None) -> str | None:
    return str(d) if d is not None else None


def serialize_holding(h: Holding, account_market_value: Decimal | None = None) -> dict:
    weight = None
    if account_market_value and account_market_value > 0 and h.market_value is not None:
        weight = float((h.market_value / account_market_value) * 100)
    gain = h.unrealized_gain
    gain_pct = None
    if gain is not None and h.cost_basis and h.cost_basis > 0:
        gain_pct = float((gain / h.cost_basis) * 100)
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
        "unrealized_gain_pct": gain_pct,
        "weight_pct": weight,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
    }


def serialize_investment_account(acct, holdings: list[Holding]) -> dict:
    market_total = sum(
        (h.market_value for h in holdings if h.market_value is not None),
        Decimal("0"),
    )
    cost_total = sum(
        (h.cost_basis for h in holdings if h.cost_basis is not None),
        Decimal("0"),
    )
    gain = market_total - cost_total if cost_total else None
    gain_pct = float((gain / cost_total) * 100) if (gain is not None and cost_total > 0) else None
    return {
        "id": acct.pk,
        "name": acct.name,
        "org_name": acct.org_name,
        "org_domain": acct.org_domain,
        "currency": acct.currency,
        "balance": _str(acct.balance),
        "balance_as_of": acct.balance_as_of.isoformat() if acct.balance_as_of else None,
        "market_value": _str(market_total),
        "cost_basis": _str(cost_total) if cost_total else None,
        "unrealized_gain": _str(gain) if gain is not None else None,
        "unrealized_gain_pct": gain_pct,
        "holdings": [serialize_holding(h, market_total) for h in holdings],
    }
