from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Count, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views import View
from django.views.decorators.http import require_POST

from inertia import render as inertia_render

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.tasks import sync_simplefin
from apps.base.http import parse_json_body
from apps.budget.data import serialize_bank_transaction
from apps.budget.models import PaymentMethod


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
        # What the account is *for*, so the page can say so. An account SimpleFIN returns holdings
        # for is the Investments page's source — the link is the holdings themselves, there is
        # nothing to map — but the page used to label it "Not in any budget" exactly like an account
        # doing nothing at all. len() over .count() so a prefetched cache is reused; .count() would
        # re-query per account, same reason the transactions below avoid an explicit order_by.
        "holdings_count": len(acct.holdings.all()),
    }
    if include_transactions:
        # Rely on BankTransaction.Meta.ordering (-posted_at) so a prefetched cache
        # is reused; an explicit .order_by() here would re-query per account (N+1).
        txns = list(acct.bank_transactions.all())[:200]
        data["transactions"] = [serialize_bank_transaction(t) for t in txns]
    return data


def _visible_to(user) -> Q:
    """
    Every account a user is entitled to, however it got here.

    A synced account proves ownership through its connection. An imported one has no connection at
    all — it exists so a file from another tool has somewhere to hang — and reaches the user through
    the budget it was filed against instead. Only the first half was ever checked, so an imported
    account was invisible on the Banking page and could not be mapped or hidden even by its owner,
    while still feeding the register through its payment method.
    """
    return Q(connection__user=user) | Q(budget__members=user)


class BankingView(LoginRequiredMixin, View):
    """Persistent view of bank data — reads from the DB, not SimpleFIN."""

    def get(self, request):
        user = request.user
        pending_counts = dict(
            BankTransaction.objects.filter(
                Q(bank_account__connection__user=user) | Q(bank_account__budget__members=user),
                status=BankTransaction.Status.PENDING,
            )
            .values("bank_account_id")
            .annotate(c=Count("id"))
            .values_list("bank_account_id", "c")
        )

        connections = []
        connections_qs = SimpleFINConnection.objects.filter(user=user).prefetch_related(
            "bank_accounts__bank_transactions", "bank_accounts__holdings"
        )
        for conn in connections_qs:
            accounts = []
            for acct in conn.bank_accounts.all():
                serialized = _serialize_bank_account(acct)
                serialized["pending_count"] = pending_counts.get(acct.pk, 0)
                accounts.append(serialized)
            connections.append(
                {
                    "id": conn.pk,
                    "label": conn.label or f"Connection #{conn.pk}",
                    "last_synced_at": conn.last_synced_at.isoformat() if conn.last_synced_at else None,
                    "last_success_at": conn.last_success_at.isoformat() if conn.last_success_at else None,
                    "last_sync_status": conn.sync_status,
                    "last_sync_error": conn.last_sync_error,
                    "accounts": accounts,
                }
            )

        payment_methods = [
            {
                "id": pm["id"],
                "name": pm["name"],
                "last_four": pm["last_four"],
                "budget_id": pm["budget_id"],
                "budget_name": pm["budget__name"] or f"Budget #{pm['budget_id']}",
            }
            for pm in PaymentMethod.objects.filter(budget__members=user, is_active=True).values(
                "id", "name", "last_four", "budget_id", "budget__name"
            )
        ]

        imported = []
        for acct in (
            BankAccount.objects.filter(connection__isnull=True, budget__members=user)
            .prefetch_related("bank_transactions", "holdings")
            .distinct()
        ):
            serialized = _serialize_bank_account(acct)
            serialized["pending_count"] = pending_counts.get(acct.pk, 0)
            imported.append(serialized)

        return inertia_render(
            request,
            "Banking",
            {
                "connections": connections,
                "imported_accounts": imported,
                "payment_methods": payment_methods,
            },
        )


@require_POST
def banking_sync(request):
    """Queue a sync of the user's SimpleFIN connections."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Not authenticated."}, status=401)

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
        acct = get_object_or_404(BankAccount, _visible_to(request.user), pk=pk)
        data = parse_json_body(request)
        if "payment_method_id" in data:
            pm_id = data["payment_method_id"]
            if pm_id is None:
                acct.payment_method = None
            else:
                pm = PaymentMethod.objects.filter(pk=pm_id, budget__members=request.user).first()
                if pm is None:
                    return JsonResponse({"error": "Payment method not found."}, status=404)
                acct.payment_method = pm
        if "is_hidden" in data:
            acct.is_hidden = bool(data["is_hidden"])
        acct.save()
        return JsonResponse(_serialize_bank_account(acct, include_transactions=False))
