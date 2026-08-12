from datetime import UTC, datetime
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.accounts.models import User
from apps.banking.models import BalanceSnapshot, BankAccount, BankTransaction, SimpleFINConnection
from apps.budget.models import Budget, PaymentMethod
from apps.investments.models import Holding


def _dt(day: int) -> datetime:
    return datetime(2026, 7, day, 12, 0, tzinfo=UTC)


class MergeDuplicateBankAccountsTest(TestCase):
    """
    Re-linking a bank hands back a new SimpleFIN id for an account you already had.

    `sync_simplefin` upserts on `(connection, simplefin_id)`, so it can't tell the difference and
    creates a second row. The old one freezes at its last sync and every account list shows both.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x/access")

    def _account(self, sfin_id, *, name="Checking (1898)", as_of=None, **kwargs):
        return BankAccount.objects.create(
            connection=self.conn,
            simplefin_id=sfin_id,
            name=name,
            org_name="Commerce Bank",
            balance_as_of=as_of,
            **kwargs,
        )

    def _txn(self, account, sfin_id, day=1, amount="-10.00"):
        return BankTransaction.objects.create(
            bank_account=account,
            simplefin_id=sfin_id,
            posted_at=_dt(day),
            amount=amount,
            description="Coffee",
        )

    def run_command(self, *args):
        out = StringIO()
        call_command("merge_duplicate_bank_accounts", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_reports_but_changes_nothing(self):
        stale = self._account("old", as_of=_dt(8))
        current = self._account("new", as_of=_dt(30))
        self._txn(stale, "t1")

        output = self.run_command()

        self.assertIn("Would merge 1 duplicate account", output)
        self.assertIn("Nothing was changed", output)
        self.assertEqual(BankAccount.objects.count(), 2)
        self.assertEqual(stale.bank_transactions.count(), 1)
        self.assertEqual(current.bank_transactions.count(), 0)

    def test_moves_history_onto_the_row_still_being_synced(self):
        # The point of merging rather than deleting: the stale row holds the older history, and the
        # current row is the only one the bridge still updates.
        stale = self._account("old", as_of=_dt(8))
        current = self._account("new", as_of=_dt(30))
        self._txn(stale, "t1", day=1)
        self._txn(stale, "t2", day=2)
        self._txn(current, "t3", day=20)
        Holding.objects.create(bank_account=stale, simplefin_id="h1", symbol="VTI")
        BalanceSnapshot.objects.create(bank_account=stale, as_of=_dt(8), balance="100.00")

        self.run_command("--apply")

        self.assertFalse(BankAccount.objects.filter(pk=stale.pk).exists())
        current.refresh_from_db()
        self.assertEqual(current.bank_transactions.count(), 3)
        self.assertEqual(current.holdings.count(), 1)
        self.assertEqual(current.balance_snapshots.count(), 1)

    def test_keeps_the_account_the_bridge_still_reports(self):
        older = self._account("old", as_of=_dt(8))
        newer = self._account("new", as_of=_dt(30))

        self.run_command("--apply")

        self.assertTrue(BankAccount.objects.filter(pk=newer.pk).exists())
        self.assertFalse(BankAccount.objects.filter(pk=older.pk).exists())

    def test_carries_the_budget_mapping_off_the_stale_row(self):
        """
        The stale row is often the one holding the payment method, since it predates the reissue.

        Deleting it without carrying the mapping would silently detach the account from its budget —
        and `BankTransaction.for_budget` reaches a budget *through* the payment method, so every one
        of those transactions would vanish from the register.
        """
        budget = Budget.objects.create(name="Household")
        pm = PaymentMethod.objects.create(budget=budget, name="Commerce", last_four="1898")
        stale = self._account("old", as_of=_dt(8), payment_method=pm)
        current = self._account("new", as_of=_dt(30))
        self.assertIsNone(current.payment_method_id)

        self.run_command("--apply")

        current.refresh_from_db()
        self.assertEqual(current.payment_method_id, pm.pk)
        self.assertFalse(BankAccount.objects.filter(pk=stale.pk).exists())

    def test_a_transaction_the_keeper_already_has_is_left_behind(self):
        # (bank_account, simplefin_id) is unique, so a row the keeper already holds cannot move.
        # That only happens when both rows carry the same bank record, and the keeper's copy wins.
        stale = self._account("old", as_of=_dt(8))
        current = self._account("new", as_of=_dt(30))
        self._txn(stale, "shared", day=7)
        self._txn(current, "shared", day=7)
        self._txn(stale, "unique-to-stale", day=1)

        output = self.run_command("--apply")

        current.refresh_from_db()
        self.assertEqual(current.bank_transactions.count(), 2)
        self.assertIn("1 already on the keeper", output)

    def test_leaves_distinct_accounts_alone(self):
        self._account("a", name="Checking (1898)", as_of=_dt(8))
        self._account("b", name="Savings (4910)", as_of=_dt(8))

        output = self.run_command("--apply")

        self.assertIn("No duplicate bank accounts found", output)
        self.assertEqual(BankAccount.objects.count(), 2)

    def test_does_not_merge_across_connections(self):
        # Two connections can legitimately serve the same institution, and an account under each is
        # two real accounts rather than one seen twice.
        other = SimpleFINConnection.objects.create(user=self.user, access_url="https://y/access")
        self._account("a", as_of=_dt(8))
        BankAccount.objects.create(
            connection=other, simplefin_id="b", name="Checking (1898)", org_name="Commerce Bank", balance_as_of=_dt(8)
        )

        output = self.run_command("--apply")

        self.assertIn("No duplicate bank accounts found", output)
        self.assertEqual(BankAccount.objects.count(), 2)

    def test_ignores_imported_accounts(self):
        # An imported account has no connection and so no SimpleFIN id to reissue.
        budget = Budget.objects.create(name="Household")
        for i in range(2):
            BankAccount.objects.create(
                connection=None, budget=budget, simplefin_id=f"imported-{i}", name="Statement", org_name="Imported"
            )

        output = self.run_command("--apply")

        self.assertIn("No duplicate bank accounts found", output)
        self.assertEqual(BankAccount.objects.count(), 2)
