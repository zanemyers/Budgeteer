from decimal import Decimal, InvalidOperation
from typing import Any

from apps.investments.models import Holding


def _to_decimal(value, default: Decimal | None = None) -> Decimal | None:
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def persist_holdings(bank_account, holdings_payload: list[dict[str, Any]] | None) -> dict:
    """Upsert holdings for a BankAccount from a SimpleFIN account's `holdings` array.

    Positions absent from the payload are deleted — SimpleFIN sends the full set
    each sync, so a missing id means the position was closed.

    Pass `None` to skip reconciliation entirely (e.g. SimpleFIN didn't return a
    `holdings` key for this account).
    """
    summary = {"new": 0, "updated": 0, "removed": 0}
    if holdings_payload is None:
        return summary

    seen_ids: set[str] = set()
    for hld in holdings_payload:
        sfin_id = hld.get("id")
        if not sfin_id:
            continue
        seen_ids.add(sfin_id)
        defaults = {
            "symbol": (hld.get("symbol") or "")[:32],
            "description": (hld.get("description") or "")[:500],
            "shares": _to_decimal(hld.get("shares"), Decimal("0")) or Decimal("0"),
            "cost_basis": _to_decimal(hld.get("cost_basis"), None),
            "market_value": _to_decimal(hld.get("market_value"), None),
            "purchase_price": _to_decimal(hld.get("purchase_price"), None),
            "currency": (hld.get("currency") or "USD")[:3],
            "raw": hld,
        }
        _, created = Holding.objects.update_or_create(
            bank_account=bank_account,
            simplefin_id=sfin_id,
            defaults=defaults,
        )
        if created:
            summary["new"] += 1
        else:
            summary["updated"] += 1

    removed, _ = (
        Holding.objects.filter(bank_account=bank_account).exclude(simplefin_id__in=seen_ids).delete()
    )
    summary["removed"] = removed
    return summary
