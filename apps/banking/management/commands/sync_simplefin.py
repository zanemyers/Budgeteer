from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.simplefin import SimpleFINError, fetch_accounts


def _to_decimal(value, default: Decimal = Decimal("0")) -> Decimal:
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def _to_datetime(unix_ts) -> datetime | None:
    if unix_ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(unix_ts), tz=UTC)
    except (TypeError, ValueError, OSError):
        return None


def sync_connection(conn: SimpleFINConnection, days: int = 90) -> dict:
    """Pull accounts + transactions for a connection and upsert into the DB.

    Returns a summary dict: {accounts, new_txns, updated_txns, errors}.
    """
    start_ts = int((datetime.now(UTC) - timedelta(days=days)).timestamp())
    summary = {"accounts": 0, "new_txns": 0, "updated_txns": 0, "errors": []}

    try:
        data = fetch_accounts(conn.access_url, start_date=start_ts)
    except SimpleFINError as e:
        conn.last_sync_error = str(e)[:1000]
        conn.last_synced_at = timezone.now()
        conn.save(update_fields=["last_sync_error", "last_synced_at"])
        summary["errors"].append(str(e))
        return summary

    api_errors = data.get("errors") or []
    summary["errors"].extend(api_errors)

    for acct in data.get("accounts", []):
        sfin_id = acct.get("id")
        if not sfin_id:
            continue
        org = acct.get("org") or {}
        bank_account, _ = BankAccount.objects.update_or_create(
            connection=conn,
            simplefin_id=sfin_id,
            defaults={
                "name": acct.get("name", "")[:255],
                "org_name": (org.get("name") or "")[:255],
                "org_domain": (org.get("domain") or "")[:255],
                "currency": (acct.get("currency") or "USD")[:3],
                "balance": _to_decimal(acct.get("balance"), Decimal("0")),
                "available_balance": (
                    _to_decimal(acct.get("available-balance"), None)
                    if acct.get("available-balance") not in (None, "")
                    else None
                ),
                "balance_as_of": _to_datetime(acct.get("balance-date")),
            },
        )
        summary["accounts"] += 1

        for txn in acct.get("transactions") or []:
            txn_id = txn.get("id")
            if not txn_id:
                continue
            # Skip pending-at-bank transactions — their id can change when they post.
            if txn.get("pending"):
                continue
            posted_at = _to_datetime(txn.get("posted")) or timezone.now()
            defaults = {
                "posted_at": posted_at,
                "amount": _to_decimal(txn.get("amount"), Decimal("0")),
                "description": (txn.get("description") or "")[:500],
                "payee": (txn.get("payee") or "")[:255],
                "memo": (txn.get("memo") or "")[:500],
                "is_pending_at_bank": bool(txn.get("pending")),
                "raw": txn,
            }
            bt, created = BankTransaction.objects.update_or_create(
                bank_account=bank_account,
                simplefin_id=txn_id,
                defaults=defaults,
            )
            if created:
                summary["new_txns"] += 1
            else:
                summary["updated_txns"] += 1
            # Keep any linked Transaction's paid_date in lockstep with the bank's posted date.
            if bt.transaction_id is not None:
                new_paid_date = posted_at.date()
                if bt.transaction.paid_date != new_paid_date:
                    bt.transaction.paid_date = new_paid_date
                    bt.transaction.save(update_fields=["paid_date", "updated_at"])

    conn.last_sync_error = "; ".join(api_errors)[:1000] if api_errors else ""
    conn.last_synced_at = timezone.now()
    conn.save(update_fields=["last_sync_error", "last_synced_at"])
    return summary


class Command(BaseCommand):
    help = "Sync SimpleFIN connections — refresh BankAccount balances and pull new BankTransactions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=90,
            help="Window (in days) of transactions to request from SimpleFIN.",
        )
        parser.add_argument(
            "--user",
            type=int,
            default=None,
            help="Only sync connections for the given user id.",
        )
        parser.add_argument(
            "--connection",
            type=int,
            default=None,
            help="Only sync a specific SimpleFINConnection by id.",
        )

    def handle(self, *args, **options):
        qs = SimpleFINConnection.objects.all()
        if options["user"]:
            qs = qs.filter(user_id=options["user"])
        if options["connection"]:
            qs = qs.filter(pk=options["connection"])

        total = qs.count()
        if not total:
            self.stdout.write("No SimpleFIN connections to sync.")
            return

        totals = {"accounts": 0, "new_txns": 0, "updated_txns": 0, "errors": 0}
        for conn in qs:
            self.stdout.write(f"Syncing {conn} (user {conn.user_id})…")
            result = sync_connection(conn, days=options["days"])
            totals["accounts"] += result["accounts"]
            totals["new_txns"] += result["new_txns"]
            totals["updated_txns"] += result["updated_txns"]
            totals["errors"] += len(result["errors"])
            for err in result["errors"]:
                self.stderr.write(f"  error: {err}")
            self.stdout.write(
                f"  {result['accounts']} accounts, "
                f"{result['new_txns']} new / {result['updated_txns']} updated transactions"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {total} connection(s): {totals['accounts']} accounts, "
                f"{totals['new_txns']} new, {totals['updated_txns']} updated, {totals['errors']} errors."
            )
        )
