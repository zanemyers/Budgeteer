"""
Merge BankAccount rows that are the same real account seen twice.

SimpleFIN identifies an account by an opaque id, and `sync_simplefin` upserts on
`(connection, simplefin_id)`. Re-linking a bank the bridge is having trouble with can hand back a
*new* id for an account you already had, at which point the sync has no way to recognise it and
creates a second row. The old row then sits frozen at whatever it last synced, and every list of
accounts shows both.

This merges them: transactions, holdings and balance snapshots move onto the surviving row and the
stale one is deleted. `sync_simplefin` learned to adopt a reissued id so new duplicates shouldn't
appear (see `_adopt_reissued_account` there) — this is for the ones already on disk.

Dry-run unless `--apply` is passed, because the last step is a delete.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.banking.models import BalanceSnapshot, BankAccount, BankTransaction
from apps.investments.models import Holding


def find_duplicate_groups(connection_id: int | None = None) -> list[list[BankAccount]]:
    """
    Group accounts that are the same real account under different SimpleFIN ids.

    Identity is `(connection, org_name, name)`. The name is the discriminator that survives a
    reissue — it carries the last four digits ("Interest Checking (1898)") — and scoping to one
    connection keeps two people's identically-named checking accounts apart.
    """
    qs = BankAccount.objects.all()
    if connection_id is not None:
        qs = qs.filter(connection_id=connection_id)

    groups: dict[tuple, list[BankAccount]] = {}
    for acct in qs.order_by("connection_id", "org_name", "name", "pk"):
        # A null connection is an imported account, which has no SimpleFIN id to reissue.
        if acct.connection_id is None:
            continue
        groups.setdefault((acct.connection_id, acct.org_name, acct.name), []).append(acct)
    return [g for g in groups.values() if len(g) > 1]


def pick_keeper(group: list[BankAccount]) -> BankAccount:
    """
    Return the row still being synced, which is the one to keep.

    `balance_as_of` is the bridge's own timestamp, so the account the bridge is still reporting has
    the newest one; the stale row stopped moving when its id was retired. Ties fall back to the most
    recently created row, then the highest pk, so the choice is never arbitrary.
    """
    return sorted(
        group,
        key=lambda a: (
            a.balance_as_of is not None,
            a.balance_as_of,
            a.created_at,
            a.pk,
        ),
    )[-1]


@transaction.atomic
def merge_group(group: list[BankAccount], *, apply: bool) -> dict:
    """Move everything from the stale rows onto the keeper and delete them."""
    keeper = pick_keeper(group)
    losers = [a for a in group if a.pk != keeper.pk]
    report = {
        "keeper": keeper,
        "losers": losers,
        "transactions": 0,
        "holdings": 0,
        "snapshots": 0,
        "skipped": 0,
        "adopted_payment_method": False,
    }

    for loser in losers:
        # Each of these is unique per (bank_account, key), so a row whose key already exists on the
        # keeper cannot be moved. That only happens when both rows genuinely hold the same record,
        # in which case the keeper's copy is the one to keep and the loser's dies with the delete.
        held = set(keeper.bank_transactions.values_list("simplefin_id", flat=True))
        movable = [t.pk for t in loser.bank_transactions.all() if t.simplefin_id not in held]
        report["skipped"] += loser.bank_transactions.count() - len(movable)
        report["transactions"] += len(movable)

        held_h = set(keeper.holdings.values_list("simplefin_id", flat=True))
        movable_h = [h.pk for h in loser.holdings.all() if h.simplefin_id not in held_h]
        report["holdings"] += len(movable_h)

        held_s = set(keeper.balance_snapshots.values_list("as_of", flat=True))
        movable_s = [s.pk for s in loser.balance_snapshots.all() if s.as_of not in held_s]
        report["snapshots"] += len(movable_s)

        # A stale row can be the one carrying the budget mapping, since it is the one that existed
        # when the mapping was made. Losing it would silently detach the account from its budget.
        if keeper.payment_method_id is None and loser.payment_method_id is not None:
            report["adopted_payment_method"] = True

        if not apply:
            continue

        BankTransaction.objects.filter(pk__in=movable).update(bank_account=keeper)
        Holding.objects.filter(pk__in=movable_h).update(bank_account=keeper)
        BalanceSnapshot.objects.filter(pk__in=movable_s).update(bank_account=keeper)
        if keeper.payment_method_id is None and loser.payment_method_id is not None:
            keeper.payment_method_id = loser.payment_method_id
            keeper.save(update_fields=["payment_method"])
        # Anything left on the loser is a duplicate of something the keeper already has.
        loser.delete()

    return report


class Command(BaseCommand):
    help = "Merge duplicate BankAccount rows left behind by a SimpleFIN account-id reissue."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually merge. Without this the command only reports what it would do.",
        )
        parser.add_argument(
            "--connection",
            type=int,
            default=None,
            help="Limit to one SimpleFIN connection id.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        groups = find_duplicate_groups(options["connection"])

        if not groups:
            self.stdout.write("No duplicate bank accounts found.")
            return

        totals = {"transactions": 0, "holdings": 0, "snapshots": 0, "skipped": 0, "deleted": 0}
        for group in groups:
            report = merge_group(group, apply=apply)
            keeper = report["keeper"]
            self.stdout.write(f"\n{keeper.org_name} — {keeper.name}")
            self.stdout.write(
                f"  keep   id={keeper.pk} simplefin_id={keeper.simplefin_id} as_of={keeper.balance_as_of}"
            )
            for loser in report["losers"]:
                self.stdout.write(
                    f"  merge  id={loser.pk} simplefin_id={loser.simplefin_id} as_of={loser.balance_as_of}"
                )
            self.stdout.write(
                f"  moves  {report['transactions']} transactions, {report['holdings']} holdings, "
                f"{report['snapshots']} balance snapshots"
                + (f", {report['skipped']} already on the keeper" if report["skipped"] else "")
                + (" · payment method carried over" if report["adopted_payment_method"] else "")
            )
            for key in ("transactions", "holdings", "snapshots", "skipped"):
                totals[key] += report[key]
            totals["deleted"] += len(report["losers"])

        verb = "Merged" if apply else "Would merge"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{verb} {totals['deleted']} duplicate account(s) across {len(groups)} group(s): "
                f"{totals['transactions']} transactions, {totals['holdings']} holdings, "
                f"{totals['snapshots']} balance snapshots moved."
            )
        )
        if not apply:
            self.stdout.write("Nothing was changed. Re-run with --apply to merge.")
