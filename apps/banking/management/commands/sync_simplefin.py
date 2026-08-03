from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.simplefin import SimpleFINError, fetch_accounts
from apps.investments.ingest import persist_holdings

COUNT_KEYS = ("accounts", "new_txns", "updated_txns", "new_holdings", "updated_holdings", "removed_holdings")


def _to_decimal(value, default: Decimal | None = Decimal("0")) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def _to_datetime(unix_ts) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(unix_ts), tz=UTC)
    except (TypeError, ValueError, OSError):
        return None


def sync_connection(conn: SimpleFINConnection, days: int = 31) -> dict:
    """
    Pull accounts + transactions for a connection and upsert into the DB.

    SimpleFIN warns at >45 days ("recommended range") and hard-caps at 90. We
    default to 31 — covers the longest month so we always pick up at least the
    last full calendar month, and stays comfortably under the recommendation.

    Returns a summary dict of per-connection counts: accounts, new/updated
    transactions, new/updated/removed holdings, and a list of error strings.
    """
    start_ts = int((datetime.now(UTC) - timedelta(days=days)).timestamp())
    # Never request data from before the connection existed — anything older
    # pre-dates the user's tracking and would just clutter the Banking page.
    if conn.created_at:
        start_ts = max(start_ts, int(conn.created_at.timestamp()))
    summary = dict.fromkeys(COUNT_KEYS, 0)
    errors: list[str] = []

    try:
        data = fetch_accounts(conn.access_url, start_date=start_ts)
    except SimpleFINError as e:
        # No data to process — record the failure; the empty dict skips the loop below.
        errors.append(str(e))
        data = {}

    errors.extend(data.get("errors") or [])

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
                "balance": _to_decimal(acct.get("balance")),
                "available_balance": _to_decimal(acct.get("available-balance"), None),
                "balance_as_of": _to_datetime(acct.get("balance-date")),
            },
        )
        summary["accounts"] += 1

        if "holdings" in acct:
            hold_result = persist_holdings(bank_account, acct.get("holdings") or [])
            summary["new_holdings"] += hold_result["new"]
            summary["updated_holdings"] += hold_result["updated"]
            summary["removed_holdings"] += hold_result["removed"]

        for txn in acct.get("transactions") or []:
            txn_id = txn.get("id")
            if not txn_id:
                continue
            # Skip pending-at-bank transactions — their id can change when they post.
            if txn.get("pending"):
                continue
            defaults = {
                "posted_at": _to_datetime(txn.get("posted")) or timezone.now(),
                "amount": _to_decimal(txn.get("amount")),
                "description": (txn.get("description") or "")[:500],
                "payee": (txn.get("payee") or "")[:255],
                "memo": (txn.get("memo") or "")[:500],
                "is_pending_at_bank": False,
                "raw": txn,
            }
            _, created = BankTransaction.objects.update_or_create(
                bank_account=bank_account,
                simplefin_id=txn_id,
                defaults=defaults,
            )
            if created:
                summary["new_txns"] += 1
            else:
                summary["updated_txns"] += 1

    conn.last_sync_error = "; ".join(errors)[:1000]
    conn.last_synced_at = timezone.now()
    conn.save(update_fields=["last_sync_error", "last_synced_at"])
    return {**summary, "errors": errors}


def _format_counts(c: dict) -> str:
    """Render a counts dict (per-connection result or grand totals) as one line."""
    return (
        f"{c['accounts']} accounts, "
        f"{c['new_txns']} new / {c['updated_txns']} updated transactions, "
        f"{c['new_holdings']} new / {c['updated_holdings']} updated / {c['removed_holdings']} removed holdings"
    )


class Command(BaseCommand):
    help = "Sync SimpleFIN connections — refresh BankAccount balances and pull new BankTransactions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=31,
            help="Window (in days) of transactions to request from SimpleFIN.",
        )
        parser.add_argument(
            "--user",
            type=int,
            help="Only sync connections for the given user id.",
        )
        parser.add_argument(
            "--connection",
            type=int,
            help="Only sync a specific SimpleFINConnection by id.",
        )

    def handle(self, *args, **options):
        qs = SimpleFINConnection.objects.all()
        if options["user"]:
            qs = qs.filter(user_id=options["user"])
        if options["connection"]:
            qs = qs.filter(pk=options["connection"])

        connections = list(qs)
        if not connections:
            self.stdout.write("No SimpleFIN connections to sync.")
            return

        totals = dict.fromkeys(COUNT_KEYS, 0)
        error_count = 0
        for conn in connections:
            # Django auto-creates the `user_id` column for the `user` FK; the IDE's
            # static analysis can't see the implicit attribute, so suppress its warning.
            # noinspection PyUnresolvedReferences
            self.stdout.write(f"Syncing {conn} (user {conn.user_id})…")
            result = sync_connection(conn, days=options["days"])
            for key in COUNT_KEYS:
                totals[key] += result[key]
            error_count += len(result["errors"])
            for err in result["errors"]:
                self.stderr.write(f"  error: {err}")
            self.stdout.write(f"  {_format_counts(result)}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {len(connections)} connection(s): {_format_counts(totals)}, {error_count} errors."
            )
        )
