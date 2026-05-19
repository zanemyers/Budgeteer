from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone


def _humanize_delta(then) -> str:
    if then is None:
        return "never"
    delta = timezone.now() - then
    if delta.total_seconds() < 60:
        return "just now"
    if delta.total_seconds() < 3600:
        return f"{int(delta.total_seconds() // 60)}m ago"
    if delta.total_seconds() < 86400:
        return f"{int(delta.total_seconds() // 3600)}h ago"
    return f"{delta.days}d ago"


def _sync_health(now):
    from apps.banking.models import SimpleFINConnection

    counts = SimpleFINConnection.objects.aggregate(
        total=Count("id"),
        ok=Count("id", filter=Q(last_synced_at__isnull=False) & Q(last_sync_error="")),
        error=Count("id", filter=~Q(last_sync_error="")),
        pending=Count("id", filter=Q(last_synced_at__isnull=True)),
    )
    last_ok = (
        SimpleFINConnection.objects.filter(last_synced_at__isnull=False, last_sync_error="")
        .order_by("-last_synced_at")
        .first()
    )
    recent_errors = list(
        SimpleFINConnection.objects.exclude(last_sync_error="")
        .order_by("-last_synced_at")[:5]
        .values("id", "label", "last_sync_error", "last_synced_at")
    )
    for e in recent_errors:
        e["when"] = _humanize_delta(e["last_synced_at"])

    return {
        "total": counts["total"],
        "ok": counts["ok"],
        "error": counts["error"],
        "pending": counts["pending"],
        "last_ok_when": _humanize_delta(last_ok.last_synced_at) if last_ok else "never",
        "recent_errors": recent_errors,
        "status_color": (
            "danger" if counts["error"] else "success" if counts["ok"] else "warning"
        ),
    }


def _currency_freshness(now):
    from apps.base.models import Currency

    latest = Currency.objects.filter(updated_at__isnull=False).order_by("-updated_at").first()
    if latest is None:
        return {"updated_at": None, "when": "never", "color": "warning", "count": 0}
    age = now - latest.updated_at
    if age < timedelta(days=1):
        color = "success"
    elif age < timedelta(days=3):
        color = "warning"
    else:
        color = "danger"
    return {
        "updated_at": latest.updated_at,
        "when": _humanize_delta(latest.updated_at),
        "color": color,
        "count": Currency.objects.count(),
    }


def _system_totals(now):
    from apps.budget.models import Budget, Transaction, TransactionLine

    User = get_user_model()
    thirty_days_ago = now - timedelta(days=30)

    # "True" spend: expense-category lines, paid, excluding sinking-fund deposits
    # and transfer transactions — matches the activity logic in apps/budget/data.py.
    real_expense_lines = (
        TransactionLine.objects.filter(
            category__category_type="expense",
            category__sinking_fund__isnull=True,
            transaction__paid_date__isnull=False,
        )
        .exclude(transaction__transaction_type="transfer")
    )
    spend_lifetime = (
        real_expense_lines.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
    )
    spend_30d = (
        real_expense_lines.annotate(
            effective_date=Coalesce("transaction__paid_date", "transaction__due_date")
        )
        .filter(effective_date__gte=thirty_days_ago.date())
        .aggregate(total=Sum("amount_usd"))["total"]
        or Decimal("0")
    )

    return {
        "users": User.objects.count(),
        "budgets": Budget.objects.count(),
        "transactions": Transaction.objects.count(),
        "transactions_30d": Transaction.objects.filter(due_date__gte=thirty_days_ago.date()).count(),
        "spend_30d_usd": spend_30d,
        "spend_lifetime_usd": spend_lifetime,
    }


def _spend_trend(now, months=6):
    """Last N months of true spend, grouped by month."""
    from apps.budget.models import TransactionLine

    start_of_window = (now.replace(day=1) - timedelta(days=32 * (months - 1))).replace(day=1)
    rows = (
        TransactionLine.objects.filter(
            category__category_type="expense",
            category__sinking_fund__isnull=True,
            transaction__paid_date__isnull=False,
        )
        .exclude(transaction__transaction_type="transfer")
        .annotate(
            effective_date=Coalesce("transaction__paid_date", "transaction__due_date")
        )
        .filter(effective_date__gte=start_of_window.date())
        .annotate(month=TruncMonth("effective_date"))
        .values("month")
        .annotate(total=Sum("amount_usd"))
        .order_by("month")
    )

    by_month = {r["month"]: r["total"] for r in rows if r["month"]}
    series = []
    cursor = start_of_window.date().replace(day=1)
    end = now.date().replace(day=1)
    while cursor <= end:
        series.append(
            {
                "label": cursor.strftime("%b %Y"),
                "amount": float(by_month.get(cursor, Decimal("0"))),
            }
        )
        # Advance one month
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    return series


def _spend_by_category(now, top_n=7):
    """Spend by category for the current calendar month, top N + 'Other' rollup."""
    from apps.budget.models import TransactionLine

    start_of_month = now.date().replace(day=1)
    rows = list(
        TransactionLine.objects.filter(
            category__category_type="expense",
            category__sinking_fund__isnull=True,
            transaction__paid_date__isnull=False,
        )
        .exclude(transaction__transaction_type="transfer")
        .annotate(
            effective_date=Coalesce("transaction__paid_date", "transaction__due_date")
        )
        .filter(effective_date__gte=start_of_month)
        .values("category__name")
        .annotate(total=Sum("amount_usd"))
        .order_by("-total")
    )

    top = rows[:top_n]
    rest_total = sum((r["total"] for r in rows[top_n:]), Decimal("0"))
    series = [{"label": r["category__name"], "amount": float(r["total"])} for r in top]
    if rest_total > 0:
        series.append({"label": "Other", "amount": float(rest_total)})
    return series


def _recent_activity(now):
    User = get_user_model()
    recent_users = list(
        User.objects.filter(last_login__isnull=False)
        .order_by("-last_login")[:5]
    )
    return {
        "users": [
            {"email": u.email, "when": _humanize_delta(u.last_login)}
            for u in recent_users
        ],
    }


def dashboard_callback(request, context):
    """Populate Unfold's admin index with operational health and aggregate stats."""
    now = timezone.now()
    context.update(
        {
            "sync_health": _sync_health(now),
            "currency_freshness": _currency_freshness(now),
            "system_totals": _system_totals(now),
            "recent_activity": _recent_activity(now),
            "spend_trend": _spend_trend(now),
            "spend_by_category": _spend_by_category(now),
        }
    )
    return context


def environment_callback(request):
    """Show an environment badge in the Unfold admin header for non-prod instances."""
    from django.conf import settings

    instance = (getattr(settings, "INSTANCE", "") or "").lower()
    if instance in {"prod", "production", ""}:
        return None
    color_map = {
        "dev": "warning",
        "local": "warning",
        "staging": "info",
        "stage": "info",
        "qa": "info",
    }
    return [instance.upper(), color_map.get(instance, "warning")]
