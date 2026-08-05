"""
Tests for reading a bank's transaction download.

The fixtures reproduce the column shapes of three real files — Chase, Capital One and Commerce —
with invented values. Those three disagreed on every question that matters: one signed Amount versus
split Debit/Credit, US versus ISO dates, and whether a category column exists at all. Getting any of
those wrong means a file that uploads and lines up with nothing.
"""

import datetime
import json
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection
from apps.budget.importing import (
    ColumnMap,
    ImportError_,
    build_preview,
    clean_amount,
    commit_import,
    guess_mapping,
    read_table,
    sniff_date_format,
)
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    PaymentMethod,
    Transaction,
    TransactionLine,
)

# One signed Amount column, US dates, expenses negative.
CHASE = b"""Transaction Date,Post Date,Description,Category,Type,Amount,Memo
08/02/2026,08/03/2026,COFFEE BAR,Food & Drink,Sale,-23.16,
08/04/2026,08/05/2026,HARDWARE STORE,Shopping,Sale,-81.40,
08/06/2026,08/07/2026,PAYMENT THANK YOU,,Payment,150.00,
"""

# Split Debit/Credit, both positive, ISO dates, two cards in one file.
CAPITAL_ONE = b"""Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-08-03,2026-08-04,2796,GROCER,Merchandise,132.00,
2026-08-05,2026-08-06,5868,FUEL STOP,Gas/Automotive,44.10,
2026-08-07,2026-08-08,2796,STATEMENT CREDIT,Other,,25.00
"""

# Split Debit/Credit, US dates, no category at all.
COMMERCE = b"""Date,No.,Description,Debit,Credit
07/06/2026,,POS PURCHASE TERMINAL 4471,26.59,
07/08/2026,,ACH DEPOSIT PAYROLL,,1204.55
07/09/2026,,POS PURCHASE TERMINAL 8890,71.02,
"""


class TestCleanAmount(SimpleTestCase):
    def test_reads_the_shapes_banks_actually_emit(self):
        cases = {
            "132.00": Decimal("132.00"),
            "-23.16": Decimal("-23.16"),
            "$1,204.55": Decimal("1204.55"),
            "(50.00)": Decimal("-50.00"),  # accounting parentheses instead of a minus
            " 44.10 ": Decimal("44.10"),
            "+12.00": Decimal("12.00"),
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(clean_amount(raw), expected)

    def test_returns_none_for_a_blank_or_unparseable_cell(self):
        for raw in ("", "   ", "-", "n/a", "--"):
            with self.subTest(raw=raw):
                self.assertIsNone(clean_amount(raw))


class TestSniffDateFormat(SimpleTestCase):
    def test_iso_is_never_read_as_something_else(self):
        self.assertEqual(sniff_date_format(["2026-08-03", "2026-08-05"]), "%Y-%m-%d")

    def test_us_order_for_slashed_dates(self):
        self.assertEqual(sniff_date_format(["08/02/2026", "12/31/2026"]), "%m/%d/%Y")

    def test_a_day_above_twelve_forces_day_first(self):
        """13/01/2026 cannot be month-first, so the whole column has to be read day-first."""
        self.assertEqual(sniff_date_format(["13/01/2026", "02/02/2026"]), "%d/%m/%Y")

    def test_returns_none_when_nothing_parses(self):
        self.assertIsNone(sniff_date_format(["last tuesday", "whenever"]))


class TestGuessMapping(SimpleTestCase):
    def _map(self, content):
        header, data = read_table(content)
        return header, guess_mapping(header, data)

    def test_chase_maps_to_a_single_signed_amount(self):
        header, mapping = self._map(CHASE)
        self.assertEqual(header[mapping.date], "Transaction Date")
        self.assertEqual(header[mapping.amount], "Amount")
        self.assertIsNone(mapping.debit)
        self.assertIsNone(mapping.credit)
        self.assertEqual(mapping.date_format, "%m/%d/%Y")
        self.assertTrue(mapping.expenses_are_negative)

    def test_capital_one_maps_to_split_debit_and_credit(self):
        header, mapping = self._map(CAPITAL_ONE)
        self.assertEqual(header[mapping.debit], "Debit")
        self.assertEqual(header[mapping.credit], "Credit")
        self.assertIsNone(mapping.amount, "a split file must not also claim a signed amount column")
        self.assertEqual(mapping.date_format, "%Y-%m-%d")
        self.assertEqual(header[mapping.card], "Card No.")

    def test_commerce_has_no_category_and_that_is_fine(self):
        header, mapping = self._map(COMMERCE)
        self.assertEqual(header[mapping.date], "Date")
        self.assertEqual(header[mapping.debit], "Debit")
        self.assertIsNone(mapping.category)
        self.assertTrue(mapping.is_usable())

    def test_the_transaction_date_wins_over_the_posted_date(self):
        """Both dual-date files carry both. When the money moved is what a statement shows."""
        for content in (CHASE, CAPITAL_ONE):
            with self.subTest(content=content[:20]):
                header, mapping = self._map(content)
                self.assertIn(header[mapping.date], ("Transaction Date",))

    def test_a_file_without_an_amount_is_not_usable(self):
        header, mapping = self._map(b"Date,Description\n08/02/2026,COFFEE\n")
        self.assertIsNone(mapping.amount)
        self.assertFalse(mapping.is_usable())


class TestDirection(SimpleTestCase):
    def test_a_debit_column_means_money_out_whatever_its_sign(self):
        preview = build_preview(CAPITAL_ONE)
        by_amount = {r.amount: r.is_inflow for r in preview.rows}
        self.assertFalse(by_amount[Decimal("132.00")], "a positive value in Debit is still an outflow")
        self.assertTrue(by_amount[Decimal("25.00")], "a value in Credit is an inflow")

    def test_a_negative_signed_amount_means_money_out(self):
        preview = build_preview(CHASE)
        self.assertEqual(preview.outflow_count, 2)
        self.assertEqual(preview.inflow_count, 1)

    def test_amounts_are_always_stored_positive(self):
        for content in (CHASE, CAPITAL_ONE, COMMERCE):
            with self.subTest(content=content[:20]):
                self.assertTrue(all(r.amount > 0 for r in build_preview(content).rows))

    def test_an_unsigned_single_amount_column_is_not_read_as_all_income(self):
        """
        Some exports state a spending account's amounts unsigned.

        Treating the sign as direction there would file every purchase as income, so when nothing in
        the column is negative the sign cannot be the signal.
        """
        content = b"Date,Description,Amount\n08/02/2026,COFFEE,23.16\n08/04/2026,FUEL,44.10\n"
        header, data = read_table(content)
        mapping = guess_mapping(header, data)
        self.assertFalse(mapping.expenses_are_negative)
        self.assertEqual(build_preview(content).outflow_count, 2)


class TestPreview(SimpleTestCase):
    def test_it_reports_the_cards_present_in_the_file(self):
        self.assertEqual(build_preview(CAPITAL_ONE).cards, ["2796", "5868"])

    def test_dates_are_parsed_to_real_dates(self):
        rows = build_preview(COMMERCE).rows
        self.assertEqual(rows[0].date, datetime.date(2026, 7, 6))

    def test_a_row_missing_a_date_is_skipped_with_a_reason(self):
        content = b"Date,Description,Amount\n,COFFEE,-23.16\n08/04/2026,FUEL,-44.10\n"
        preview = build_preview(content)
        self.assertEqual(len(preview.rows), 1)
        self.assertEqual(preview.skipped, [(2, "no date")])

    def test_a_zero_amount_row_is_skipped(self):
        content = b"Date,Description,Amount\n08/02/2026,NOTHING,0.00\n08/04/2026,FUEL,-44.10\n"
        preview = build_preview(content)
        self.assertEqual(len(preview.rows), 1)
        self.assertEqual(preview.skipped, [(2, "amount is zero")])

    def test_a_byte_order_mark_does_not_break_the_first_column(self):
        """A BOM otherwise becomes part of the first header's name and stops it matching."""
        preview = build_preview(b"\xef\xbb\xbf" + CHASE)
        self.assertEqual(preview.header[0], "Transaction Date")
        self.assertEqual(len(preview.rows), 3)

    def test_a_semicolon_separated_file_still_reads(self):
        content = b"Date;Description;Amount\n08/02/2026;COFFEE;-23.16\n08/04/2026;FUEL;-44.10\n"
        self.assertEqual(len(build_preview(content).rows), 2)

    def test_an_explicit_mapping_overrides_the_guess(self):
        """The preview is confirmable, so a corrected mapping has to be honoured over detection."""
        header, _ = read_table(CHASE)
        override = ColumnMap(date=1, amount=5, description=2, date_format="%m/%d/%Y")
        preview = build_preview(CHASE, override=override)
        self.assertEqual(preview.rows[0].date, datetime.date(2026, 8, 3), "should use Post Date, not Transaction Date")

    def test_an_empty_file_is_refused_clearly(self):
        for content, fragment in (
            (b"", "empty"),
            (b"Date,Description,Amount\n", "no transactions"),
            (b"Colour,Shape\nred,round\n", "date column"),
        ):
            with self.subTest(fragment=fragment):
                with self.assertRaises(ImportError_) as caught:
                    build_preview(content)
                self.assertIn(fragment, str(caught.exception))


class CommitTestCase(TestCase):
    """Shared fixture for the write path, which needs a budget, a category and a payment method."""

    def setUp(self):
        self.user = User.objects.create_user(username="u", email="u@example.com", password="pw")  # noqa: S106
        self.budget = Budget.objects.create(created_by=self.user, name="Household")
        BudgetMembership.objects.create(budget=self.budget, user=self.user, role=BudgetMembership.ROLE_OWNER)
        self.groceries = Category.objects.create(
            budget=self.budget, name="Groceries", category_type=Category.TYPE_EXPENSE
        )
        self.visa = PaymentMethod.objects.create(budget=self.budget, name="Visa", last_four="2796")

    def _commit(self, content, method=None, auto_log=True):
        return commit_import(self.budget, self.user, build_preview(content), method or self.visa, auto_log=auto_log)


class TestCommitLandsInReview(CommitTestCase):
    """
    Rows land as pending bank transactions, not as unpaid transactions.

    That is what gives them the match suggestions and the categorise action synced rows already have,
    and it keeps "mark paid" from stamping today over the date on the statement.
    """

    def test_rows_become_pending_bank_transactions(self):
        result = self._commit(COMMERCE)
        self.assertEqual(result.created, 3)
        self.assertEqual(BankTransaction.objects.filter(status=BankTransaction.Status.PENDING).count(), 3)

    def test_no_unpaid_transactions_are_invented(self):
        self._commit(COMMERCE)
        self.assertFalse(Transaction.objects.filter(paid_date__isnull=True).exists())

    def test_the_statement_date_is_kept(self):
        self._commit(COMMERCE)
        dates = sorted(bt.posted_at.date() for bt in BankTransaction.objects.all())
        self.assertEqual(dates[0], datetime.date(2026, 7, 6))

    def test_outflows_are_signed_negative_like_a_synced_row(self):
        """bank_matching decides direction from the sign, so an imported row has to match."""
        self._commit(COMMERCE)
        amounts = sorted(bt.amount for bt in BankTransaction.objects.all())
        self.assertEqual(amounts[0], Decimal("-71.02"))
        self.assertEqual(amounts[-1], Decimal("1204.55"), "the payroll deposit stays positive")

    def test_the_account_is_marked_as_imported_not_synced(self):
        self._commit(COMMERCE)
        account = BankAccount.objects.get()
        self.assertIsNone(account.connection_id)
        self.assertTrue(account.is_imported)
        self.assertEqual(account.payment_method, self.visa)


class TestReimportIsANoOp(CommitTestCase):
    def test_importing_the_same_file_twice_adds_nothing(self):
        """Bank downloads overlap: you take 30 days twice and 25 of them repeat."""
        self._commit(COMMERCE)
        again = self._commit(COMMERCE)
        self.assertEqual(again.created, 0)
        self.assertEqual(again.duplicates, 3)
        self.assertEqual(BankTransaction.objects.count(), 3)

    def test_genuinely_identical_rows_are_kept_apart(self):
        """
        Two identical purchases on one day are two transactions.

        Hashing them to the same fingerprint would silently collapse them into one, which is the
        failure mode that makes an importer quietly lose money.
        """
        content = (
            b"Date,Description,Amount\n"
            b"08/02/2026,COFFEE BAR,-4.75\n"
            b"08/02/2026,COFFEE BAR,-4.75\n"
            b"08/02/2026,COFFEE BAR,-4.75\n"
        )
        result = self._commit(content)
        self.assertEqual(result.created, 3, "identical rows collapsed into one")
        self.assertEqual(self._commit(content).duplicates, 3, "and re-importing them is still a no-op")

    def test_an_overlapping_second_file_only_adds_the_new_rows(self):
        first = b"Date,Description,Amount\n08/02/2026,COFFEE,-4.75\n08/03/2026,FUEL,-40.00\n"
        overlapping = first + b"08/04/2026,GROCER,-22.10\n"
        self._commit(first)
        result = self._commit(overlapping)
        self.assertEqual((result.created, result.duplicates), (1, 2))


class TestCardsAndPaymentMethods(CommitTestCase):
    def test_a_card_matching_a_payment_methods_last_four_claims_its_rows(self):
        result = self._commit(CAPITAL_ONE)
        self.assertEqual(result.unmatched_cards, ["5868"], "the card with no payment method is named")
        accounts = {a.payment_method_id: a for a in BankAccount.objects.all()}
        self.assertIn(self.visa.pk, accounts, "card 2796 should have landed on the Visa")

    def test_an_unmatched_card_falls_back_rather_than_being_dropped(self):
        result = self._commit(CAPITAL_ONE)
        self.assertEqual(result.created, 3, "no row is lost just because its card is not set up")

    def test_a_second_payment_method_splits_the_file_by_card(self):
        other = PaymentMethod.objects.create(budget=self.budget, name="Savor", last_four="5868")
        self._commit(CAPITAL_ONE)
        by_method = {
            bt.bank_account.payment_method_id: bt for bt in BankTransaction.objects.select_related("bank_account")
        }
        self.assertIn(other.pk, by_method, "card 5868 should now claim its own rows")
        self.assertIn(self.visa.pk, by_method)

    def test_the_card_number_is_recorded_on_the_row(self):
        """So "which card was this" stays answerable even when the card is not set up."""
        self._commit(CAPITAL_ONE)
        cards = {bt.raw.get("card") for bt in BankTransaction.objects.all()}
        self.assertEqual(cards, {"2796", "5868"})


class TestAutoLogging(CommitTestCase):
    def test_a_category_naming_one_of_ours_is_logged_outright(self):
        """What happens when a file that came out of Budgeteer's own export goes back in."""
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        result = self._commit(content)
        self.assertEqual(result.logged, 1)
        txn = Transaction.objects.get()
        self.assertEqual(txn.paid_date, datetime.date(2026, 8, 2))
        self.assertEqual(txn.lines.get().category, self.groceries)

    def test_a_banks_own_category_names_nothing_here_so_it_goes_to_review(self):
        content = b"Date,Description,Category,Amount\n08/02/2026,COFFEE,Food & Drink,-4.75\n"
        result = self._commit(content)
        self.assertEqual(result.logged, 0)
        self.assertEqual(result.created, 1)
        self.assertFalse(Transaction.objects.exists())

    def test_matching_is_case_insensitive(self):
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,groceries,-89.59\n"
        self.assertEqual(self._commit(content).logged, 1)

    def test_a_row_that_already_exists_is_not_logged_twice(self):
        """
        Re-importing a Budgeteer export would otherwise duplicate every transaction in it.

        The fingerprint stops a second import of the same file, but the first import of an export
        taken from this same budget describes transactions that are already on the books.
        """
        existing = Transaction.objects.create(
            budget=self.budget,
            created_by=self.user,
            description="ALDI",
            due_date=datetime.date(2026, 8, 2),
            paid_date=datetime.date(2026, 8, 2),
            transaction_type="expense",
        )
        TransactionLine.objects.create(
            transaction=existing, category=self.groceries, amount=Decimal("89.59"), amount_usd=Decimal("89.59")
        )
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        result = self._commit(content)

        self.assertEqual(result.logged, 0, "it made a second copy of a transaction already recorded")
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(result.created, 1, "but it still lands in review so it can be linked")

    def test_auto_log_can_be_turned_off(self):
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        result = self._commit(content, auto_log=False)
        self.assertEqual(result.logged, 0)
        self.assertFalse(Transaction.objects.exists())


class TestImportView(CommitTestCase):
    """
    The endpoint is two-step on purpose.

    A column mapping is a guess until someone confirms it, so POST without `commit` describes what
    would happen and writes nothing. Only POST with `commit` writes.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
        self.url = reverse("budget:transaction-import", kwargs={"budget_pk": self.budget.pk})

    def _upload(self, content, name="statement.csv", **extra):
        return self.client.post(self.url, {"file": SimpleUploadedFile(name, content, "text/csv"), **extra})

    def test_a_preview_writes_nothing(self):
        res = self._upload(COMMERCE)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["row_count"], 3)
        self.assertEqual(BankTransaction.objects.count(), 0, "a preview must not write")

    def test_a_preview_reports_what_it_found(self):
        body = self._upload(CAPITAL_ONE, payment_method=self.visa.pk).json()
        self.assertEqual(body["header"][body["mapping"]["debit"]], "Debit")
        self.assertEqual((body["outflow_count"], body["inflow_count"]), (2, 1))
        self.assertEqual(body["cards"], ["2796", "5868"])
        self.assertEqual(body["unmatched_cards"], ["5868"])
        self.assertEqual(len(body["sample"]), 3)

    def test_committing_writes_the_rows(self):
        res = self._upload(COMMERCE, payment_method=self.visa.pk, commit="1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["created"], 3)
        self.assertEqual(BankTransaction.objects.count(), 3)

    def test_committing_without_an_account_is_allowed(self):
        """
        A file from another budgeting tool can cover several accounts.

        Demanding one would either be a lie or block the import, so unattributed rows land in review
        and someone decides there whether to fill in the account before logging or push it through.
        """
        res = self._upload(COMMERCE, commit="1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["created"], 3)
        self.assertEqual(BankTransaction.objects.count(), 3)

    def test_a_corrected_mapping_is_honoured(self):
        """The preview is confirmable, so a mapping sent back has to override detection."""
        mapping = json.dumps({"date": 1, "amount": 5, "description": 2, "date_format": "%m/%d/%Y"})
        body = self._upload(CHASE, mapping=mapping).json()
        self.assertEqual(body["sample"][0]["date"], "2026-08-03", "should have used Post Date")

    def test_a_file_with_no_date_column_is_refused_with_a_reason(self):
        res = self._upload(b"Colour,Shape\nred,round\n")
        self.assertEqual(res.status_code, 400)
        self.assertIn("date column", res.json()["errors"]["file"][0])

    def test_a_missing_file_is_refused(self):
        res = self.client.post(self.url, {})
        self.assertEqual(res.status_code, 400)
        self.assertIn("file", res.json()["errors"])

    def test_a_payment_method_from_another_budget_is_refused(self):
        other = Budget.objects.create(created_by=self.user)
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        stranger = PaymentMethod.objects.create(budget=other, name="Elsewhere")
        res = self._upload(COMMERCE, payment_method=stranger.pk, commit="1")
        self.assertEqual(res.status_code, 400)
        self.assertIn("payment_method", res.json()["errors"])

    def test_someone_elses_budget_cannot_be_imported_into(self):
        stranger = User.objects.create_user(username="other", email="o@example.com", password="pw")  # noqa: S106
        other = Budget.objects.create(created_by=stranger)
        BudgetMembership.objects.create(budget=other, user=stranger, role=BudgetMembership.ROLE_OWNER)
        url = reverse("budget:transaction-import", kwargs={"budget_pk": other.pk})
        res = self.client.post(url, {"file": SimpleUploadedFile("s.csv", COMMERCE, "text/csv")})
        self.assertEqual(res.status_code, 404)

    def test_an_oversized_file_is_refused_before_being_parsed(self):
        big = b"Date,Description,Amount\n" + (b"08/02/2026,ROW,-1.00\n" * 300_000)
        res = self._upload(big)
        self.assertEqual(res.status_code, 400)
        self.assertIn("5 MB", res.json()["errors"]["file"][0])

    def test_a_round_trip_through_our_own_export_lands_in_review(self):
        """
        The flat export's headers are ours, so its columns should map without a correction.

        Its category names are ours too, which is the one case where auto-logging fires.
        """
        content = (
            b"Date,Description,Category,Category type,Amount,Payment method,Notes,Status\n"
            b"2026-08-02,ALDI,Groceries,expense,89.59,Visa,,paid\n"
        )
        body = self._upload(content, payment_method=self.visa.pk, commit="1").json()
        self.assertEqual(body["created"], 1)
        self.assertEqual(body["logged"], 1, "our own category names should log outright")


class TestImportedRowsAreVisible(CommitTestCase):
    """
    Writing the rows is not enough; the page has to list them.

    Both bank-row queries filtered on bank_account__connection__user, and an imported account has no
    connection, so that join excluded every imported row. They were written and then invisible on the
    page meant to review them. The earlier tests only asserted the rows existed, which is exactly the
    gap that let it through.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _pending_on_page(self, month="2026-07"):
        url = reverse("budget:transaction-list", kwargs={"budget_pk": self.budget.pk})
        res = self.client.get(f"{url}?month={month}", headers={"x-inertia": "true", "x-inertia-version": "1.0"})
        self.assertEqual(res.status_code, 200)
        return res.json()["props"]["bank_transactions"]

    def test_imported_rows_appear_in_the_review_pane(self):
        self._commit(COMMERCE)
        self.assertEqual(len(self._pending_on_page()), 3, "imported rows were written but not listed")

    def test_they_appear_even_with_no_payment_method_at_all(self):
        """A file from another tool may name no account, and those rows still have to be reviewable."""
        result = commit_import(self.budget, self.user, build_preview(COMMERCE), None)
        self.assertEqual(result.created, 3)
        self.assertEqual(len(self._pending_on_page()), 3)

    def test_an_unattributed_account_is_still_tied_to_the_budget(self):
        commit_import(self.budget, self.user, build_preview(COMMERCE), None)
        account = BankAccount.objects.get()
        self.assertIsNone(account.payment_method)
        self.assertEqual(account.budget, self.budget, "nothing else links this account to a budget")

    def test_another_budgets_imported_rows_are_not_listed(self):
        other = Budget.objects.create(created_by=self.user, name="Other")
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        commit_import(other, self.user, build_preview(COMMERCE), None)
        self.assertEqual(self._pending_on_page(), [], "an import leaked across budgets")

    def test_the_suggestions_endpoint_reaches_an_imported_row(self):
        """The point of landing in review is the match suggestions, so they have to be reachable."""
        self._commit(COMMERCE)
        bank_txn = BankTransaction.objects.first()
        url = reverse("budget:bank-txn-suggestions", kwargs={"budget_pk": self.budget.pk, "pk": bank_txn.pk})
        self.assertEqual(self.client.get(url).status_code, 200)


class TestUnattributedImport(CommitTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def test_rows_land_without_an_account_rather_than_being_skipped(self):
        result = commit_import(self.budget, self.user, build_preview(CHASE), None)
        self.assertEqual(result.created, 3)
        self.assertEqual(result.skipped, [])

    def test_a_matching_card_still_claims_its_rows_with_no_fallback_chosen(self):
        """Card 2796 matches the Visa, so it should be attributed even when nothing was picked."""
        commit_import(self.budget, self.user, build_preview(CAPITAL_ONE), None)
        methods = {a.payment_method_id for a in BankAccount.objects.all()}
        self.assertIn(self.visa.pk, methods)
        self.assertIn(None, methods, "the unmatched card's rows sit in the unattributed bucket")

    def test_committing_with_no_account_is_accepted_by_the_endpoint(self):
        url = reverse("budget:transaction-import", kwargs={"budget_pk": self.budget.pk})
        res = self.client.post(url, {"file": SimpleUploadedFile("s.csv", COMMERCE, "text/csv"), "commit": "1"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["created"], 3)


class TestTheChosenAccountCarriesThrough(CommitTestCase):
    """
    Picking an account at import has to reach the transaction that comes out of review.

    Otherwise choosing "Capital One" on upload buys nothing: the row lands pending, you categorise it,
    and the transaction it becomes has no account even though the file said which one it was.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _confirm(self, bank_txn, **extra):
        url = reverse("budget:bank-txn-create", kwargs={"budget_pk": self.budget.pk, "pk": bank_txn.pk})
        return self.client.post(
            url,
            data=json.dumps({"category_id": self.groceries.pk, **extra}),
            content_type="application/json",
        )

    def test_the_account_lands_on_the_transaction_without_being_asked_for_again(self):
        self._commit(COMMERCE, method=self.visa)
        bank_txn = BankTransaction.objects.filter(amount__lt=0).first()

        res = self._confirm(bank_txn)
        self.assertEqual(res.status_code, 201, res.content)
        bank_txn.refresh_from_db()
        self.assertEqual(bank_txn.transaction.payment_method, self.visa)

    def test_an_explicit_account_still_wins_over_the_imported_one(self):
        other = PaymentMethod.objects.create(budget=self.budget, name="Cash")
        self._commit(COMMERCE, method=self.visa)
        bank_txn = BankTransaction.objects.filter(amount__lt=0).first()

        self._confirm(bank_txn, payment_method_id=other.pk)
        bank_txn.refresh_from_db()
        self.assertEqual(bank_txn.transaction.payment_method, other)

    def test_a_card_matched_row_carries_the_card_s_own_account(self):
        """Not the one picked at upload: the card said which account it was."""
        savor = PaymentMethod.objects.create(budget=self.budget, name="Savor", last_four="5868")
        commit_import(self.budget, self.user, build_preview(CAPITAL_ONE), self.visa)
        row = BankTransaction.objects.get(raw__card="5868")

        self._confirm(row)
        row.refresh_from_db()
        self.assertEqual(row.transaction.payment_method, savor)

    def test_an_unattributed_row_produces_a_transaction_with_no_account(self):
        commit_import(self.budget, self.user, build_preview(COMMERCE), None)
        bank_txn = BankTransaction.objects.filter(amount__lt=0).first()

        self._confirm(bank_txn)
        bank_txn.refresh_from_db()
        self.assertIsNone(bank_txn.transaction.payment_method, "nothing said which account this was")

    def test_an_auto_logged_row_already_carries_the_account(self):
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        self._commit(content, method=self.visa)
        self.assertEqual(Transaction.objects.get().payment_method, self.visa)


class TestDeletingAnImportedRow(CommitTestCase):
    """
    An imported row can be deleted; a synced one cannot.

    Ignore exists because a synced row comes back on the next sync. Nothing brings an imported row
    back, so ignoring it would leave permanent clutter and delete is the honest action.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _url(self, bank_txn):
        return reverse("budget:bank-txn-delete", kwargs={"budget_pk": self.budget.pk, "pk": bank_txn.pk})

    def test_an_imported_row_can_be_deleted(self):
        self._commit(COMMERCE)
        bank_txn = BankTransaction.objects.first()
        res = self.client.delete(self._url(bank_txn))
        self.assertEqual(res.status_code, 204)
        self.assertEqual(BankTransaction.objects.count(), 2)

    def test_a_synced_row_is_refused(self):
        """Deleting one would be undone by the next sync, so it would only look like it worked."""
        connection = SimpleFINConnection.objects.create(user=self.user, access_url="https://example.invalid/x")
        account = BankAccount.objects.create(
            connection=connection, simplefin_id="acct-1", name="Synced", payment_method=self.visa
        )
        synced = BankTransaction.objects.create(
            bank_account=account,
            simplefin_id="bt-1",
            posted_at=timezone.now(),
            amount=Decimal("-10.00"),
            status=BankTransaction.Status.PENDING,
        )
        res = self.client.delete(self._url(synced))
        self.assertEqual(res.status_code, 400)
        self.assertIn("next sync", res.json()["errors"]["detail"][0])
        self.assertTrue(BankTransaction.objects.filter(pk=synced.pk).exists())

    def test_a_row_linked_to_a_transaction_is_refused(self):
        """The transaction is the part worth keeping, and unlinking is already its own step."""
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        self._commit(content)
        linked = BankTransaction.objects.get()
        self.assertIsNotNone(linked.transaction_id)
        res = self.client.delete(self._url(linked))
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unlink", res.json()["errors"]["detail"][0])

    def test_another_budgets_row_cannot_be_deleted(self):
        other = Budget.objects.create(created_by=self.user, name="Other")
        BudgetMembership.objects.create(budget=other, user=self.user, role=BudgetMembership.ROLE_OWNER)
        commit_import(other, self.user, build_preview(COMMERCE), None)
        stranger_row = BankTransaction.objects.first()
        res = self.client.delete(self._url(stranger_row))
        self.assertEqual(res.status_code, 404)
        self.assertTrue(BankTransaction.objects.filter(pk=stranger_row.pk).exists())


class TestUndoingAnImport(CommitTestCase):
    """
    The common regret is the wrong file, or a mapping wrong in a way the preview did not make obvious.

    Both want the whole import gone rather than a row at a time.
    """

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _undo(self, batch):
        return self.client.delete(
            reverse("budget:import-batch-delete", kwargs={"budget_pk": self.budget.pk, "batch": batch})
        )

    def test_undoing_removes_every_row_from_that_import(self):
        result = self._commit(COMMERCE)
        res = self._undo(result.batch)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["rows"], 3)
        self.assertEqual(BankTransaction.objects.count(), 0)

    def test_it_leaves_a_different_import_alone(self):
        first = self._commit(COMMERCE)
        second = self._commit(CHASE)
        self._undo(first.batch)
        remaining = {bt.raw.get("import_batch") for bt in BankTransaction.objects.all()}
        self.assertEqual(remaining, {second.batch})

    def test_transactions_the_import_logged_go_with_it(self):
        """Nobody categorised those by hand, so they are part of the import, not work to preserve."""
        content = b"Date,Description,Category,Amount\n08/02/2026,ALDI,Groceries,-89.59\n"
        result = self._commit(content)
        self.assertEqual(Transaction.objects.count(), 1)

        res = self._undo(result.batch)
        self.assertEqual(res.json()["transactions"], 1)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_a_transaction_categorised_through_review_is_kept(self):
        """That one is someone's work. It survives, detached from the row going away."""
        self._commit(COMMERCE)
        batch = BankTransaction.objects.first().raw["import_batch"]
        bank_txn = BankTransaction.objects.filter(amount__lt=0).first()
        self.client.post(
            reverse("budget:bank-txn-create", kwargs={"budget_pk": self.budget.pk, "pk": bank_txn.pk}),
            data=json.dumps({"category_id": self.groceries.pk}),
            content_type="application/json",
        )
        self.assertEqual(Transaction.objects.count(), 1)

        self._undo(batch)
        self.assertEqual(
            Transaction.objects.count(), 1, "a transaction categorised by hand was destroyed with the import"
        )

    def test_an_unknown_batch_is_a_404(self):
        self.assertEqual(self._undo("nope").status_code, 404)

    def test_undoing_lets_the_same_file_be_imported_again(self):
        """The fingerprint is what makes re-import a no-op, so undo has to actually clear it."""
        result = self._commit(COMMERCE)
        self._undo(result.batch)
        again = self._commit(COMMERCE)
        self.assertEqual(again.created, 3)
        self.assertEqual(again.duplicates, 0)
