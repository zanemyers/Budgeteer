from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views import View
from django.views.decorators.http import require_POST

from inertia import render as inertia_render

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.base.http import parse_json_body
from apps.budget.data import serialize_bank_transaction


def _serialize_bank_account(acct: BankAccount, *, include_transactions: bool = True) -> dict:
    data = {
        "id": acct.pk,
        "name": acct.name,
        "org_name": acct.org_name,
        "org_domain": acct.org_domain,
        "currency": acct.currency,
        "balance": str(acct.balance) if acct.balance is not None else None,
        "available_balance": str(acct.available_balance) if acct.available_balance is not None else None,
        "balance_as_of": acct.balance_as_of.isoformat() if acct.balance_as_of else None,
        "payment_method_id": acct.payment_method_id,
        "is_hidden": acct.is_hidden,
        "pending_count": 0,
    }
    if include_transactions:
        txns = acct.bank_transactions.all().order_by("-posted_at")[:200]
        data["transactions"] = [serialize_bank_transaction(t) for t in txns]
    return data


class BankingView(LoginRequiredMixin, View):
    """Persistent view of bank data — reads from the DB, not SimpleFIN."""

    def get(self, request):
        user = request.user
        pending_counts = dict(
            BankTransaction.objects
            .filter(bank_account__connection__user=user, status=BankTransaction.Status.PENDING)
            .values("bank_account_id")
            .annotate(c=Count("id"))
            .values_list("bank_account_id", "c")
        )

        connections = []
        for conn in SimpleFINConnection.objects.filter(user=user).prefetch_related("bank_accounts"):
            accounts = []
            for acct in conn.bank_accounts.all():
                serialized = _serialize_bank_account(acct)
                serialized["pending_count"] = pending_counts.get(acct.pk, 0)
                accounts.append(serialized)
            connections.append({
                "id": conn.pk,
                "label": conn.label or f"Connection #{conn.pk}",
                "last_synced_at": conn.last_synced_at.isoformat() if conn.last_synced_at else None,
                "last_sync_status": conn.sync_status,
                "last_sync_error": conn.last_sync_error,
                "accounts": accounts,
            })

        from apps.budget.models import PaymentMethod
        payment_methods = list(
            PaymentMethod.objects.filter(budget__members=user, is_active=True)
            .select_related("budget")
            .values("id", "name", "last_four", "budget_id", "budget__name")
        )
        payment_methods_serialized = [
            {
                "id": pm["id"],
                "name": pm["name"],
                "last_four": pm["last_four"],
                "budget_id": pm["budget_id"],
                "budget_name": pm["budget__name"] or f"Budget #{pm['budget_id']}",
            }
            for pm in payment_methods
        ]

        return inertia_render(request, "Banking", {
            "connections": connections,
            "payment_methods": payment_methods_serialized,
        })


@require_POST
def banking_sync(request):
    """Queue a sync of the user's SimpleFIN connections."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Not authenticated."}, status=401)
    from apps.banking.tasks import sync_simplefin

    data = parse_json_body(request)
    conn_id = data.get("connection_id")
    if conn_id:
        try:
            conn = SimpleFINConnection.objects.get(pk=conn_id, user=request.user)
        except SimpleFINConnection.DoesNotExist:
            return JsonResponse({"error": "Connection not found."}, status=404)
        sync_simplefin.delay(connection_id=conn.pk)
    else:
        sync_simplefin.delay()
    return JsonResponse({"ok": True})


class BankAccountUpdateView(LoginRequiredMixin, View):
    """Set the PaymentMethod a BankAccount maps to (or hide it)."""

    def patch(self, request, pk):
        acct = get_object_or_404(BankAccount, pk=pk, connection__user=request.user)
        data = parse_json_body(request)
        if "payment_method_id" in data:
            pm_id = data["payment_method_id"]
            if pm_id is None:
                acct.payment_method = None
            else:
                from apps.budget.models import PaymentMethod
                pm = PaymentMethod.objects.filter(pk=pm_id, budget__members=request.user).first()
                if pm is None:
                    return JsonResponse({"error": "Payment method not found."}, status=404)
                acct.payment_method = pm
        if "is_hidden" in data:
            acct.is_hidden = bool(data["is_hidden"])
        acct.save()
        return JsonResponse(_serialize_bank_account(acct, include_transactions=False))
