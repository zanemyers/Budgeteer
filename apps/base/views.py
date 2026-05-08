import time
from datetime import UTC, datetime, timedelta

from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views import View
from django.views.decorators.http import require_POST

from inertia import render as inertia_render

from apps.base.models import SimpleFINConnection
from apps.base.simplefin import SimpleFINError, fetch_accounts


def http_500(request):
    raise Exception


def http_404(request):
    return render(request, "404.html")


@require_POST
@staff_member_required
def refresh_exchange_rates(request):
    """Admin action: queue the update_exchange_rates Celery task. JSON for AJAX, redirect otherwise."""
    from apps.base.tasks import update_exchange_rates

    update_exchange_rates.delay()
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        return JsonResponse({"ok": True})
    messages.success(request, "Exchange rates refresh queued. Rates will update in a few seconds.")
    return redirect("admin:index")


class BankingView(LoginRequiredMixin, View):
    """Live read-only view of accounts/transactions from all of the user's SimpleFIN connections."""

    DEFAULT_DAYS = 30

    def get(self, request):
        days = int(request.GET.get("days", self.DEFAULT_DAYS))
        start_ts = int((datetime.now(UTC) - timedelta(days=days)).timestamp())

        connections_payload = []
        for conn in SimpleFINConnection.objects.filter(user=request.user):
            entry: dict = {
                "id": conn.pk,
                "label": conn.label or f"Connection #{conn.pk}",
                "accounts": [],
                "errors": [],
                "fetch_error": None,
            }
            try:
                data = fetch_accounts(conn.access_url, start_date=start_ts)
            except SimpleFINError as e:
                entry["fetch_error"] = str(e)
                conn.last_sync_status = SimpleFINConnection.SyncStatus.ERROR
                conn.last_sync_error = str(e)[:1000]
                conn.last_synced_at = timezone.now()
                conn.save(update_fields=["last_sync_status", "last_sync_error", "last_synced_at"])
            else:
                entry["errors"] = data.get("errors", [])
                entry["accounts"] = [
                    _serialize_account(acct) for acct in data.get("accounts", [])
                ]
                conn.last_sync_status = (
                    SimpleFINConnection.SyncStatus.ERROR
                    if entry["errors"]
                    else SimpleFINConnection.SyncStatus.OK
                )
                conn.last_sync_error = "; ".join(entry["errors"])[:1000] if entry["errors"] else ""
                conn.last_synced_at = timezone.now()
                conn.save(update_fields=["last_sync_status", "last_sync_error", "last_synced_at"])
            connections_payload.append(entry)

        return inertia_render(request, "Banking", {
            "connections": connections_payload,
            "days": days,
            "fetched_at": int(time.time()),
        })


def _serialize_account(acct: dict) -> dict:
    org = acct.get("org") or {}
    txns = acct.get("transactions") or []
    return {
        "id": acct.get("id"),
        "name": acct.get("name", ""),
        "currency": acct.get("currency", ""),
        "balance": acct.get("balance", ""),
        "available_balance": acct.get("available-balance"),
        "balance_date": acct.get("balance-date"),
        "org_name": org.get("name", ""),
        "org_domain": org.get("domain", ""),
        "transactions": [
            {
                "id": t.get("id"),
                "posted": t.get("posted"),
                "amount": t.get("amount", ""),
                "description": t.get("description", ""),
                "payee": t.get("payee", ""),
                "memo": t.get("memo", ""),
                "pending": t.get("pending", False),
            }
            for t in txns
        ],
    }
