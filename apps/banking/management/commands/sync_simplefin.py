from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.banking.models import BalanceSnapshot, BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.simplefin import SimpleFINError, fetch_accounts
from apps.investments.ingest import persist_holdings

COUNT_KEYS = (
    "accounts",
    "new_balances",
    "new_txns",
    "updated_txns",
    "new_holdings",
    "updated_holdings",
    "removed_holdings",
)


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


def _adopt_reissued_account(conn: SimpleFINConnection, sfin_id: str, acct: dict, incoming_ids: set[str]) -> None:
    """
    Re-point an existing account at a new SimpleFIN id instead of letting a second row be created.

    Re-linking a bank the bridge is struggling with can hand back a *new* id for an account you
    already had. Accounts are upserted on `(connection, simplefin_id)`, so the sync can't recognise
    it and makes a second row: the old one freezes at its last sync, keeps its transactions and its
    payment-method mapping, and every account list shows the same account twice.

    Adoption needs two things to line up, and the second is what makes it safe:

    1. Exactly one existing account on this connection has the same name and institution. The name
       carries the discriminator ("Interest Checking (1898)"), and more than one match is ambiguous
       enough to leave alone.
    2. That account's id is absent from the payload we are currently processing — it has *vanished*
       from the feed. An account the bridge still reports is a different, live account that merely
       shares a name, and must not be adopted.

    A genuinely new account matches nothing and falls through to being created, which is right.
    `merge_duplicate_bank_accounts` cleans up pairs that predate this.
    """
    name = (acct.get("name") or "")[:255]
    if not name:
        # With no name there is nothing to match on, and every unnamed account would look alike.
        return
    if BankAccount.objects.filter(connection=conn, simplefin_id=sfin_id).exists():
        return

    org_name = ((acct.get("org") or {}).get("name") or "")[:255]
    candidates = list(
        BankAccount.objects.filter(connection=conn, name=name, org_name=org_name).exclude(
            simplefin_id__in=incoming_ids
        )[:2]
    )
    if len(candidates) != 1:
        return

    # update() rather than save() so this is a single statement and cannot race with the
    # update_or_create that immediately follows it.
    BankAccount.objects.filter(pk=candidates[0].pk).update(simplefin_id=sfin_id)


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

    # Every id this payload reports, so an account that has *disappeared* from the feed can be told
    # apart from one that is merely absent from the row we happen to be looking at.
    incoming_ids = {a.get("id") for a in data.get("accounts", []) if a.get("id")}

    for acct in data.get("accounts", []):
        sfin_id = acct.get("id")
        if not sfin_id:
            continue
        # Claims an existing row whose id was retired, so the upsert below updates it in place
        # rather than creating a duplicate beside it.
        _adopt_reissued_account(conn, sfin_id, acct, incoming_ids)
        org = acct.get("org") or {}
        balance = _to_decimal(acct.get("balance"))
        available = _to_decimal(acct.get("available-balance"), None)
        balance_as_of = _to_datetime(acct.get("balance-date"))
        bank_account, _ = BankAccount.objects.update_or_create(
            connection=conn,
            simplefin_id=sfin_id,
            defaults={
                "name": acct.get("name", "")[:255],
                "org_name": (org.get("name") or "")[:255],
                "org_domain": (org.get("domain") or "")[:255],
                "currency": (acct.get("currency") or "USD")[:3],
                "balance": balance,
                "available_balance": available,
                "balance_as_of": balance_as_of,
            },
        )
        summary["accounts"] += 1

        # The fields above are overwritten every run, so keep the reading before it is lost. Keyed
        # on the bridge's balance-date so an unchanged daily balance records once across the four
        # daily syncs rather than four times.
        if balance is not None:
            _, snapshot_created = BalanceSnapshot.objects.update_or_create(
                bank_account=bank_account,
                as_of=balance_as_of or timezone.now(),
                defaults={"balance": balance, "available_balance": available},
            )
            if snapshot_created:
                summary["new_balances"] += 1

        if "holdings" in acct:
            # Pass the value through unchanged. `or []` here would turn a null holdings
            # value into an empty list, which persist_holdings reads as "every position
            # was closed" — deleting the account's whole portfolio, cost basis included.
            hold_result = persist_holdings(bank_account, acct.get("holdings"))
            summary["new_holdings"] += hold_result["new"]
            summary["updated_holdings"] += hold_result["updated"]
            summary["removed_holdings"] += hold_result["removed"]
            if hold_result["skipped_empty"]:
                # Surfaced as a connection error so it reaches the Banking page rather than
                # only the cron log — an empty payload usually means the bridge is unhealthy.
                errors.append(
                    f"{bank_account.name}: SimpleFIN returned no holdings for an account that has "
                    f"positions on record. Kept the existing holdings; re-check after the next sync."
                )

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

    now = timezone.now()
    conn.last_sync_error = "; ".join(errors)[:1000]
    conn.last_synced_at = now
    # Only a clean run moves last_success_at. last_synced_at records the attempt either way, which
    # is what lets sync_status tell a blip apart from something that has been failing all day.
    # A failed run leaves the column out of update_fields entirely rather than rewriting whatever
    # the in-memory object happened to hold.
    updated = ["last_sync_error", "last_synced_at"]
    if not errors:
        conn.last_success_at = now
        updated.append("last_success_at")
    conn.save(update_fields=updated)
    return {**summary, "errors": errors}


def _format_counts(c: dict) -> str:
    """Render a counts dict (per-connection result or grand totals) as one line."""
    return (
        f"{c['accounts']} accounts, "
        f"{c['new_balances']} new balances, "
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
