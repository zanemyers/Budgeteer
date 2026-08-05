from datetime import UTC
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from apps.accounts.models import User

# Intentionally unit-testing the command module's internal helpers.
# noinspection PyProtectedMember
from apps.banking.management.commands.sync_simplefin import _to_datetime, _to_decimal, sync_connection
from apps.banking.models import BalanceSnapshot, BankAccount, BankTransaction, SimpleFINConnection
from apps.banking.simplefin import SimpleFINError
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
