import datetime
from datetime import UTC
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from apps.accounts.models import User

# Intentionally unit-testing the command module's internal helpers.
# noinspection PyProtectedMember
from apps.banking.management.commands.sync_simplefin import _to_datetime, _to_decimal, sync_connection
from apps.banking.models import BalanceSnapshot, BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.simplefin import SimpleFINError
from apps.budget.models import Budget, PaymentMethod
from apps.investments.models import Holding

FETCH_PATH = "apps.banking.management.commands.sync_simplefin.fetch_accounts"
HOLDINGS_PATH = "apps.banking.management.commands.sync_simplefin.persist_holdings"


def _payload(**overrides):
    payload = {
        "errors": [],
        "accounts": [
            {
                "id": "acct-1",
                "name": "Checking",
                "currency": "USD",
                "org": {"name": "Big Bank", "domain": "bigbank.com"},
                "balance": "100.00",
                "available-balance": "90.00",
                "balance-date": 1700000000,
                "transactions": [
                    {
                        "id": "txn-1",
                        "posted": 1700000000,
                        "amount": "-12.34",
                        "description": "Coffee",
                        "payee": "Cafe",
                        "memo": "",
                    },
                ],
            }
        ],
    }
    payload.update(overrides)
    return payload


class TestToDecimal(SimpleTestCase):
    def test_parses_numbers(self):
        self.assertEqual(_to_decimal("12.34"), Decimal("12.34"))
        self.assertEqual(_to_decimal(5), Decimal("5"))

    def test_returns_default_on_garbage(self):
        self.assertEqual(_to_decimal("abc"), Decimal("0"))
        self.assertEqual(_to_decimal(None), Decimal("0"))

    def test_custom_default_can_be_none(self):
        self.assertIsNone(_to_decimal(None, None))
        self.assertIsNone(_to_decimal("", None))


class TestToDatetime(SimpleTestCase):
    def test_parses_unix_timestamp(self):
        dt = _to_datetime(1700000000)
        assert dt is not None
        self.assertEqual(dt.tzinfo, UTC)

    def test_returns_none_on_bad_input(self):
        self.assertIsNone(_to_datetime(None))
        self.assertIsNone(_to_datetime("nope"))


class TestSyncConnection(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x/access", label="B")

    @patch(FETCH_PATH)
    def test_creates_accounts_and_transactions(self, mock_fetch):
        mock_fetch.return_value = _payload()
        summary = sync_connection(self.conn)

        self.assertEqual(summary["accounts"], 1)
        self.assertEqual(summary["new_txns"], 1)
        self.assertEqual(summary["updated_txns"], 0)
        self.assertEqual(summary["errors"], [])

        acct = BankAccount.objects.get(connection=self.conn, simplefin_id="acct-1")
        self.assertEqual(acct.name, "Checking")
        self.assertEqual(acct.org_name, "Big Bank")
        self.assertEqual(acct.balance, Decimal("100.00"))
        self.assertEqual(acct.available_balance, Decimal("90.00"))

        txn = BankTransaction.objects.get(bank_account=acct, simplefin_id="txn-1")
        self.assertEqual(txn.amount, Decimal("-12.34"))
        self.assertEqual(txn.description, "Coffee")

        self.conn.refresh_from_db()
        self.assertIsNotNone(self.conn.last_synced_at)
        self.assertEqual(self.conn.last_sync_error, "")

    @patch(FETCH_PATH)
    def test_second_sync_updates_rather_than_duplicating(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)
        summary = sync_connection(self.conn)

        self.assertEqual(summary["new_txns"], 0)
        self.assertEqual(summary["updated_txns"], 1)
        self.assertEqual(BankAccount.objects.count(), 1)
        self.assertEqual(BankTransaction.objects.count(), 1)

    @patch(FETCH_PATH)
    def test_skips_pending_transactions(self, mock_fetch):
        payload = _payload()
        payload["accounts"][0]["transactions"].append(
            {"id": "txn-pending", "posted": 1700000000, "amount": "1.00", "pending": True}
        )
        mock_fetch.return_value = payload
        summary = sync_connection(self.conn)

        self.assertEqual(summary["new_txns"], 1)
        self.assertFalse(BankTransaction.objects.filter(simplefin_id="txn-pending").exists())

    @patch(FETCH_PATH)
    def test_records_fetch_error(self, mock_fetch):
        mock_fetch.side_effect = SimpleFINError("access revoked")
        summary = sync_connection(self.conn)

        self.assertEqual(summary["accounts"], 0)
        self.assertIn("access revoked", summary["errors"])
        self.conn.refresh_from_db()
        self.assertIn("access revoked", self.conn.last_sync_error)
        self.assertIsNotNone(self.conn.last_synced_at)

    @patch(HOLDINGS_PATH)
    @patch(FETCH_PATH)
    def test_persists_holdings_when_present(self, mock_fetch, mock_holdings):
        mock_holdings.return_value = {"new": 2, "updated": 1, "removed": 0, "skipped_empty": False}
        payload = _payload()
        payload["accounts"][0]["holdings"] = [{"id": "h1"}]
        mock_fetch.return_value = payload

        summary = sync_connection(self.conn)
        self.assertEqual(summary["new_holdings"], 2)
        self.assertEqual(summary["updated_holdings"], 1)
        mock_holdings.assert_called_once()

    @patch(FETCH_PATH)
    def test_null_holdings_does_not_wipe_the_portfolio(self, mock_fetch):
        """
        A null holdings value must not be read as "every position closed".

        The command used to pass `acct.get("holdings") or []`, which turned None into an
        empty list — and persist_holdings deletes anything absent from the payload, so a
        single null-holdings sync deleted the account's whole portfolio, cost basis included.
        """
        payload = _payload()
        payload["accounts"][0]["holdings"] = [{"id": "h1", "symbol": "AAPL", "cost_basis": "1000.00"}]
        mock_fetch.return_value = payload
        sync_connection(self.conn)
        self.assertEqual(Holding.objects.count(), 1)

        payload["accounts"][0]["holdings"] = None
        mock_fetch.return_value = payload
        summary = sync_connection(self.conn)

        self.assertEqual(Holding.objects.count(), 1)
        self.assertEqual(Holding.objects.get().cost_basis, Decimal("1000.00"))
        self.assertEqual(summary["removed_holdings"], 0)
        # None is a legitimate "no holdings data for this account" signal, so it must reach
        # persist_holdings as None and return quietly. Coercing it to [] would instead trip
        # the empty-payload guard and report a spurious sync error every six hours.
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.last_sync_error, "")

    @patch(FETCH_PATH)
    def test_empty_holdings_keeps_the_portfolio_and_reports_it(self, mock_fetch):
        payload = _payload()
        payload["accounts"][0]["holdings"] = [{"id": "h1", "symbol": "AAPL", "cost_basis": "1000.00"}]
        mock_fetch.return_value = payload
        sync_connection(self.conn)

        payload["accounts"][0]["holdings"] = []
        mock_fetch.return_value = payload
        summary = sync_connection(self.conn)

        self.assertEqual(Holding.objects.count(), 1)
        self.assertEqual(summary["removed_holdings"], 0)
        self.conn.refresh_from_db()
        self.assertIn("no holdings", self.conn.last_sync_error)

    @patch(FETCH_PATH)
    def test_holdings_key_absent_leaves_holdings_untouched(self, mock_fetch):
        payload = _payload()
        payload["accounts"][0]["holdings"] = [{"id": "h1", "symbol": "AAPL"}]
        mock_fetch.return_value = payload
        sync_connection(self.conn)

        payload["accounts"][0].pop("holdings")
        mock_fetch.return_value = payload
        sync_connection(self.conn)
        self.assertEqual(Holding.objects.count(), 1)


class TestSyncCommand(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106

    def test_reports_when_no_connections(self):
        out = StringIO()
        call_command("sync_simplefin", stdout=out)
        self.assertIn("No SimpleFIN connections", out.getvalue())

    @patch(FETCH_PATH)
    def test_syncs_all_connections(self, mock_fetch):
        mock_fetch.return_value = _payload()
        conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="B")
        out = StringIO()
        call_command("sync_simplefin", stdout=out)

        self.assertEqual(BankAccount.objects.filter(connection=conn).count(), 1)
        self.assertIn("Synced 1 connection", out.getvalue())

    @patch(FETCH_PATH)
    def test_connection_filter_only_syncs_that_connection(self, mock_fetch):
        mock_fetch.return_value = _payload()
        conn1 = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="One")
        conn2 = SimpleFINConnection.objects.create(user=self.user, access_url="https://y", label="Two")

        call_command("sync_simplefin", connection=conn1.pk, stdout=StringIO())
        self.assertTrue(BankAccount.objects.filter(connection=conn1).exists())
        self.assertFalse(BankAccount.objects.filter(connection=conn2).exists())


class TestBalanceSnapshots(TestCase):
    """
    A balance reading has to survive the next sync.

    BankAccount.balance is overwritten in place on every run and the sync runs four times a day,
    so each reading used to be discarded as fast as the next arrived. Nothing could reconstruct it
    afterwards, which made net worth over time impossible to build later — history is the one
    thing that cannot be backfilled.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x/access", label="B")

    @patch(FETCH_PATH)
    def test_a_sync_records_the_balance(self, mock_fetch):
        mock_fetch.return_value = _payload()
        summary = sync_connection(self.conn)

        snapshot = BalanceSnapshot.objects.get()
        self.assertEqual(snapshot.balance, Decimal("100.00"))
        self.assertEqual(snapshot.available_balance, Decimal("90.00"))
        self.assertEqual(snapshot.as_of, _to_datetime(1700000000))
        self.assertEqual(summary["new_balances"], 1)

    @patch(FETCH_PATH)
    def test_resyncing_an_unchanged_balance_does_not_pile_up_rows(self, mock_fetch):
        """Four syncs a day against a balance the bank restates once a day is one reading."""
        mock_fetch.return_value = _payload()
        for _ in range(4):
            summary = sync_connection(self.conn)

        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(summary["new_balances"], 0, "a repeat reading should not count as new")

    @patch(FETCH_PATH)
    def test_a_new_balance_date_starts_a_new_reading(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)

        later = _payload()
        later["accounts"][0]["balance"] = "250.00"
        later["accounts"][0]["balance-date"] = 1700086400
        mock_fetch.return_value = later
        sync_connection(self.conn)

        self.assertEqual(BalanceSnapshot.objects.count(), 2)
        self.assertEqual(
            [s.balance for s in BalanceSnapshot.objects.all()],
            [Decimal("250.00"), Decimal("100.00")],
            "newest first, per Meta.ordering",
        )

    @patch(FETCH_PATH)
    def test_a_corrected_amount_for_a_timestamp_we_hold_wins(self, mock_fetch):
        """Same balance-date, different amount: the bank restated it, so keep the newer figure."""
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)

        corrected = _payload()
        corrected["accounts"][0]["balance"] = "111.11"
        mock_fetch.return_value = corrected
        sync_connection(self.conn)

        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(BalanceSnapshot.objects.get().balance, Decimal("111.11"))

    @patch(FETCH_PATH)
    def test_a_missing_balance_date_falls_back_to_the_sync_time(self, mock_fetch):
        payload = _payload()
        del payload["accounts"][0]["balance-date"]
        mock_fetch.return_value = payload
        sync_connection(self.conn)

        snapshot = BalanceSnapshot.objects.get()
        self.assertIsNotNone(snapshot.as_of)
        self.assertEqual(snapshot.balance, Decimal("100.00"))

    @patch(FETCH_PATH)
    def test_snapshots_follow_the_account_when_it_is_deleted(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)

        BankAccount.objects.get().delete()
        self.assertEqual(BalanceSnapshot.objects.count(), 0)


class TestSyncStatusGrading(TestCase):
    """
    A blip and a broken connection must not look the same.

    Every failure used to make sync_status "error", which the Banking page renders as a red alert.
    A read timeout therefore looked exactly like a revoked access URL, and since only a later
    success clears the stored message and the cron runs every six hours, one stall sat in a red
    banner for most of a day. last_synced_at was also stamped on failed attempts, so the page
    reported a failed run as the last successful sync.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x/access", label="B")

    def test_never_attempted_is_pending(self):
        self.assertEqual(self.conn.sync_status, "pending")

    @patch(FETCH_PATH)
    def test_a_clean_run_is_ok_and_records_a_success(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)
        self.conn.refresh_from_db()

        self.assertEqual(self.conn.sync_status, "ok")
        self.assertEqual(self.conn.last_success_at, self.conn.last_synced_at)

    @patch(FETCH_PATH)
    def test_a_failure_after_a_recent_success_is_only_stale(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)

        mock_fetch.side_effect = SimpleFINError("Read timed out")
        sync_connection(self.conn)
        self.conn.refresh_from_db()

        self.assertEqual(self.conn.sync_status, "stale", "a single stall should not read as broken")
        succeeded, attempted = self.conn.last_success_at, self.conn.last_synced_at
        self.assertTrue(
            succeeded is not None and attempted is not None and succeeded < attempted,
            f"the failed attempt should not count as a success: succeeded={succeeded} attempted={attempted}",
        )

    @patch(FETCH_PATH)
    def test_a_failure_with_no_recent_success_is_an_error(self, mock_fetch):
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)

        # Push the last success outside the grace window: this is no longer a blip.
        stale_success = timezone.now() - SimpleFINConnection.STALE_GRACE - datetime.timedelta(minutes=1)
        SimpleFINConnection.objects.filter(pk=self.conn.pk).update(last_success_at=stale_success)

        mock_fetch.side_effect = SimpleFINError("Access URL is no longer valid. Re-link the connection.")
        sync_connection(self.conn)
        self.conn.refresh_from_db()

        self.assertEqual(self.conn.sync_status, "error")

    @patch(FETCH_PATH)
    def test_a_failure_with_no_success_on_record_is_an_error(self, mock_fetch):
        """A connection that has never worked gets no grace period it has not earned."""
        mock_fetch.side_effect = SimpleFINError("Read timed out")
        sync_connection(self.conn)
        self.conn.refresh_from_db()

        self.assertIsNone(self.conn.last_success_at)
        self.assertEqual(self.conn.sync_status, "error")

    @patch(FETCH_PATH)
    def test_recovering_clears_the_error_and_moves_the_success(self, mock_fetch):
        mock_fetch.side_effect = SimpleFINError("Read timed out")
        sync_connection(self.conn)

        mock_fetch.side_effect = None
        mock_fetch.return_value = _payload()
        sync_connection(self.conn)
        self.conn.refresh_from_db()

        self.assertEqual(self.conn.last_sync_error, "")
        self.assertEqual(self.conn.sync_status, "ok")
        self.assertIsNotNone(self.conn.last_success_at)


class TestReissuedAccountIds(TestCase):
    """
    Re-linking a bank can hand back a new SimpleFIN id for an account you already had.

    Accounts upsert on `(connection, simplefin_id)`, so without adoption the sync cannot recognise
    the account and creates a second row beside it — the old one frozen at its last sync, still
    holding its transactions and its payment-method mapping.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="password")  # noqa: S106
        self.conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x/access")

    def _existing(self, sfin_id, name="Checking", org="Big Bank"):
        return BankAccount.objects.create(connection=self.conn, simplefin_id=sfin_id, name=name, org_name=org)

    @patch(FETCH_PATH)
    def test_a_reissued_id_updates_the_account_in_place(self, mock_fetch):
        old = self._existing("acct-OLD")
        BankTransaction.objects.create(
            bank_account=old, simplefin_id="t-old", posted_at=timezone.now(), amount="-5.00", description="History"
        )
        # Same account, same name, new id — and the old id is gone from the feed.
        mock_fetch.return_value = _payload()

        sync_connection(self.conn)

        self.assertEqual(BankAccount.objects.filter(connection=self.conn).count(), 1)
        old.refresh_from_db()
        self.assertEqual(old.simplefin_id, "acct-1")
        # The history rode along, which is the entire point of adopting rather than recreating.
        self.assertEqual(old.bank_transactions.filter(simplefin_id="t-old").count(), 1)

    @patch(FETCH_PATH)
    def test_the_payment_method_mapping_survives(self, mock_fetch):
        # BankTransaction.for_budget reaches a budget *through* the payment method, so a new row
        # would take every one of this account's transactions out of the register.
        budget = Budget.objects.create(name="Household")
        pm = PaymentMethod.objects.create(budget=budget, name="Commerce", last_four="1898")
        old = self._existing("acct-OLD")
        old.payment_method = pm
        old.save(update_fields=["payment_method"])
        mock_fetch.return_value = _payload()

        sync_connection(self.conn)

        old.refresh_from_db()
        self.assertEqual(old.simplefin_id, "acct-1")
        self.assertEqual(old.payment_method_id, pm.pk)

    @patch(FETCH_PATH)
    def test_an_account_still_in_the_feed_is_never_adopted(self, mock_fetch):
        """
        The safety condition: only a *vanished* id may be adopted.

        Two live accounts can share a name — a second "Checking" at the same bank is a real thing —
        and folding them together would merge two people's money.
        """
        still_live = self._existing("acct-1")
        payload = _payload()
        payload["accounts"].append({**payload["accounts"][0], "id": "acct-2", "transactions": []})
        mock_fetch.return_value = payload

        sync_connection(self.conn)

        still_live.refresh_from_db()
        self.assertEqual(still_live.simplefin_id, "acct-1")
        self.assertEqual(BankAccount.objects.filter(connection=self.conn).count(), 2)

    @patch(FETCH_PATH)
    def test_two_stale_candidates_are_left_alone(self, mock_fetch):
        # Ambiguous: nothing says which of the two the new id belongs to, so a third row is the
        # honest outcome and merge_duplicate_bank_accounts can sort it out with a human looking.
        self._existing("acct-OLD-1")
        self._existing("acct-OLD-2")
        mock_fetch.return_value = _payload()

        sync_connection(self.conn)

        self.assertEqual(BankAccount.objects.filter(connection=self.conn).count(), 3)

    @patch(FETCH_PATH)
    def test_a_different_account_is_not_adopted(self, mock_fetch):
        savings = self._existing("acct-OLD", name="Savings")
        mock_fetch.return_value = _payload()

        sync_connection(self.conn)

        savings.refresh_from_db()
        self.assertEqual(savings.simplefin_id, "acct-OLD")
        self.assertEqual(BankAccount.objects.filter(connection=self.conn).count(), 2)

    @patch(FETCH_PATH)
    def test_another_connection_is_never_adopted_from(self, mock_fetch):
        other = SimpleFINConnection.objects.create(user=self.user, access_url="https://y/access")
        theirs = BankAccount.objects.create(
            connection=other, simplefin_id="acct-OLD", name="Checking", org_name="Big Bank"
        )
        mock_fetch.return_value = _payload()

        sync_connection(self.conn)

        theirs.refresh_from_db()
        self.assertEqual(theirs.simplefin_id, "acct-OLD")
        self.assertEqual(BankAccount.objects.filter(connection=self.conn).count(), 1)
