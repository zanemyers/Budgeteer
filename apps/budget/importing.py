"""
Read a bank's transaction download and work out what its columns mean.

Every bank exports a different shape, so there are no per-bank parsers here. Three real files from
three banks disagreed on every question that matters:

    Chase        Transaction Date, Post Date, Description, Category, Type, Amount, Memo
                 MM/DD/YYYY, one signed Amount, expenses negative
    Capital One  Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
                 YYYY-MM-DD, split Debit/Credit, both all-positive
    Commerce     Date, No., Description, Debit, Credit
                 MM/DD/YYYY, split Debit/Credit, both all-positive, no category at all

So: guess the mapping from the header names and the shape of the values, hand the guess back for
confirmation, and write nothing until someone has looked at it. Two of those three use split
Debit/Credit columns, which makes direction a question of *which column holds the value* rather
than of its sign — that is the majority path, not an edge case.
"""

import csv
import datetime
import hashlib
import io
import re
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

# Ordered by preference. A file with both a transaction date and a posted date should key on when
# the money moved, since that is the date on the statement and the one anyone remembers.
DATE_HEADERS = ("transaction date", "trans date", "date", "posted date", "post date", "posting date")
AMOUNT_HEADERS = ("amount", "transaction amount")
DEBIT_HEADERS = ("debit", "withdrawal", "withdrawals", "money out")
CREDIT_HEADERS = ("credit", "deposit", "deposits", "money in")
DESCRIPTION_HEADERS = ("description", "payee", "name", "merchant", "transaction description", "details")
CATEGORY_HEADERS = ("category", "categories")
NOTE_HEADERS = ("memo", "note", "notes", "comments", "comment")
CARD_HEADERS = ("card no.", "card no", "card number", "account", "account number", "last 4")

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%b %d, %Y")

# Enough rows to tell a date format and a sign convention apart without reading a whole year.
SNIFF_ROWS = 200


class ImportError_(Exception):
    """A file that cannot be read at all, as opposed to one whose columns need confirming."""


@dataclass
class ColumnMap:
    date: int | None = None
    amount: int | None = None
    debit: int | None = None
    credit: int | None = None
    description: int | None = None
    category: int | None = None
    note: int | None = None
    card: int | None = None
    date_format: str | None = None
    # True when a lone Amount column holds expenses as negatives, which is the usual convention but
    # not a universal one. Ignored when debit/credit are split, where the column decides direction.
    expenses_are_negative: bool = True

    def is_usable(self) -> bool:
        """Amount and date are the only columns worth refusing a file over."""
        return self.date is not None and (self.amount is not None or self.debit is not None or self.credit is not None)


@dataclass
class ParsedRow:
    date: datetime.date
    amount: Decimal  # Always positive; direction is carried separately.
    is_inflow: bool
    description: str
    category: str
    note: str
    card: str
    line_number: int


@dataclass
class Preview:
    header: list[str]
    mapping: ColumnMap
    rows: list[ParsedRow]
    skipped: list[tuple[int, str]] = field(default_factory=list)
    cards: list[str] = field(default_factory=list)

    @property
    def inflow_count(self) -> int:
        return sum(1 for r in self.rows if r.is_inflow)

    @property
    def outflow_count(self) -> int:
        return len(self.rows) - self.inflow_count


def _normalise(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def _find(header: list[str], candidates: tuple[str, ...]) -> int | None:
    """Exact header match first, then a containment match, so 'Posting Date' still resolves."""
    cleaned = [_normalise(h) for h in header]
    for candidate in candidates:
        if candidate in cleaned:
            return cleaned.index(candidate)
    for candidate in candidates:
        for index, name in enumerate(cleaned):
            if candidate in name:
                return index
    return None


def clean_amount(value: str) -> Decimal | None:
    """
    Turn a bank's idea of money into a Decimal.

    Handles a currency symbol, thousands separators, a trailing or leading sign, and accounting
    parentheses, which some exports use for negatives instead of a minus.
    """
    text = (value or "").strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    text = re.sub(r"[^\d.\-+]", "", text)
    if text in ("", "-", "+", "."):
        return None
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    return -amount if negative else amount


def sniff_date_format(values: list[str]) -> str | None:
    """
    Pick the format that parses every sample.

    Tried in order, so an unambiguous ISO date is never read as anything else. A file where day and
    month are both under 13 throughout is genuinely ambiguous; US order wins because that is what
    every bank in these samples emits.
    """
    samples = [v.strip() for v in values if v and v.strip()][:SNIFF_ROWS]
    if not samples:
        return None
    for fmt in DATE_FORMATS:
        try:
            for sample in samples:
                datetime.datetime.strptime(sample, fmt)  # noqa: DTZ007 - a bare date, no zone involved
        except ValueError:
            continue
        else:
            return fmt
    return None


def read_table(content: bytes) -> tuple[list[str], list[list[str]]]:
    """
    Split a CSV into its header and its data rows.

    utf-8-sig because a leading byte-order mark otherwise becomes part of the first column's name
    and stops it matching anything. The delimiter is sniffed so a semicolon-separated export still
    reads.
    """
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    if not text.strip():
        raise ImportError_("That file is empty.")

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(cell.strip() for cell in r)]
    if not rows:
        raise ImportError_("That file has no rows in it.")
    header, data = rows[0], rows[1:]
    if not data:
        raise ImportError_("That file has a header but no transactions.")
    return header, data


def guess_mapping(header: list[str], data: list[list[str]]) -> ColumnMap:
    """Work out which column is which, from the header names and then from the values."""
    mapping = ColumnMap(
        date=_find(header, DATE_HEADERS),
        amount=_find(header, AMOUNT_HEADERS),
        debit=_find(header, DEBIT_HEADERS),
        credit=_find(header, CREDIT_HEADERS),
        description=_find(header, DESCRIPTION_HEADERS),
        category=_find(header, CATEGORY_HEADERS),
        note=_find(header, NOTE_HEADERS),
        card=_find(header, CARD_HEADERS),
    )
    # A split Debit/Credit pair is the real signal. When one is present the other's absence should
    # not leave a stray `amount` guess pointing at the same column.
    if (mapping.debit is not None or mapping.credit is not None) and mapping.amount in (mapping.debit, mapping.credit):
        mapping.amount = None

    if mapping.date is not None:
        mapping.date_format = sniff_date_format([row[mapping.date] for row in data if mapping.date < len(row)])

    if mapping.amount is not None:
        values = [clean_amount(row[mapping.amount]) for row in data if mapping.amount < len(row)]
        present = [v for v in values if v is not None]
        negatives = sum(1 for v in present if v < 0)
        # A spending account's export is mostly outflows. If almost nothing is negative, this file
        # states amounts unsigned and the sign cannot be what marks direction.
        mapping.expenses_are_negative = bool(present) and negatives > 0
    return mapping


def parse_rows(
    header: list[str], data: list[list[str]], mapping: ColumnMap
) -> tuple[list[ParsedRow], list[tuple[int, str]]]:
    """
    Turn raw cells into rows, collecting the reason for anything skipped.

    Skipped rows are returned rather than dropped: a file where half the lines fail should say so in
    the preview, not quietly import the other half.
    """
    parsed: list[ParsedRow] = []
    skipped: list[tuple[int, str]] = []

    def cell(row: list[str], index: int | None) -> str:
        if index is None or index >= len(row):
            return ""
        return row[index].strip()

    for offset, row in enumerate(data, start=2):  # line 1 is the header
        raw_date = cell(row, mapping.date)
        if not raw_date:
            skipped.append((offset, "no date"))
            continue
        parsed_date = None
        for fmt in ([mapping.date_format] if mapping.date_format else []) + list(DATE_FORMATS):
            try:
                parsed_date = datetime.datetime.strptime(raw_date, fmt).date()  # noqa: DTZ007
            except ValueError:
                continue
            else:
                break
        if parsed_date is None:
            skipped.append((offset, f"could not read the date {raw_date!r}"))
            continue

        debit = clean_amount(cell(row, mapping.debit)) if mapping.debit is not None else None
        credit = clean_amount(cell(row, mapping.credit)) if mapping.credit is not None else None
        single = clean_amount(cell(row, mapping.amount)) if mapping.amount is not None else None

        if debit or credit:
            # Which column the value sits in decides direction, whatever its sign.
            amount = abs(debit) if debit else abs(credit)
            is_inflow = not debit
        elif single is not None:
            amount = abs(single)
            is_inflow = single > 0 if mapping.expenses_are_negative else single < 0
        else:
            skipped.append((offset, "no amount"))
            continue

        if amount == 0:
            skipped.append((offset, "amount is zero"))
            continue

        parsed.append(
            ParsedRow(
                date=parsed_date,
                amount=amount,
                is_inflow=is_inflow,
                description=cell(row, mapping.description)[:500],
                category=cell(row, mapping.category)[:200],
                note=cell(row, mapping.note)[:500],
                card=cell(row, mapping.card)[:50],
                line_number=offset,
            )
        )
    return parsed, skipped


def build_preview(content: bytes, override: ColumnMap | None = None) -> Preview:
    """Read a file and describe what importing it would do, without writing anything."""
    header, data = read_table(content)
    mapping = override or guess_mapping(header, data)
    if not mapping.is_usable():
        raise ImportError_("Could not find a date column and an amount column. Point them out and try again.")
    rows, skipped = parse_rows(header, data, mapping)
    if not rows:
        raise ImportError_("None of the rows in that file could be read.")
    cards = sorted({r.card for r in rows if r.card})
    return Preview(header=header, mapping=mapping, rows=rows, skipped=skipped, cards=cards)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def row_fingerprint(row: "ParsedRow", occurrence: int) -> str:
    """
    Build a stable id for a row, so re-importing an overlapping range writes nothing new.

    Bank downloads always overlap — you take "last 30 days" twice and 25 of them repeat — and
    BankTransaction is unique on (bank_account, simplefin_id), so hashing the row makes a second
    import a no-op for free.

    `occurrence` distinguishes rows that are genuinely identical. Two coffees on the same day for the
    same amount at the same shop are two transactions, and hashing them to the same value would
    silently collapse them into one. Counting within the file keeps them apart while staying stable
    across re-imports of that same file.
    """
    material = "\x1f".join(
        [row.date.isoformat(), f"{row.amount:.2f}", "in" if row.is_inflow else "out", row.description, row.card]
    )
    digest = hashlib.sha256(material.encode()).hexdigest()[:40]
    return f"import:{digest}:{occurrence}"


def resolve_payment_methods(budget, cards: list[str], fallback):
    """
    Match each card number in the file to a payment method by its last four.

    A statement can cover more than one card. PaymentMethod already stores last_four, so a card that
    has been set up claims its own rows and one that has not falls back — which gives per-card
    tracking to anyone who wants it without adding a setting for it.
    """
    from apps.budget.models import PaymentMethod

    by_last_four = {
        pm.last_four: pm for pm in PaymentMethod.objects.filter(budget=budget).exclude(last_four="") if pm.last_four
    }
    resolved = {card: by_last_four.get(card, fallback) for card in cards}
    unmatched = sorted(card for card in cards if card not in by_last_four)
    return resolved, unmatched


@dataclass
class ImportResult:
    created: int = 0
    duplicates: int = 0
    logged: int = 0
    unmatched_cards: list[str] = field(default_factory=list)
    skipped: list[tuple[int, str]] = field(default_factory=list)
    # Stamped on every row this run wrote, so the whole thing can be undone. The common regret is the
    # wrong file or a mapping that was wrong in a way the preview did not make obvious, and both want
    # all of it gone rather than a row at a time.
    batch: str = ""


def commit_import(budget, user, preview: Preview, payment_method=None, auto_log: bool = True) -> ImportResult:
    """
    Write a previewed file into the awaiting-review pipeline.

    Rows land as pending BankTransactions rather than as unpaid Transactions, so they get the match
    suggestions, link-to-existing and categorise actions that synced rows already have — and so
    "mark paid" cannot stamp today's date over the date on the statement.

    A row whose category names one of this budget's categories is logged outright, which is what
    happens when a file that came out of Budgeteer's own export goes back in. A bank's own category
    ("Food & Drink", "Gas/Automotive") names nothing here, so those stay blank and go to review.

    No payment method is required. A file exported from another budgeting tool can cover several
    accounts, and demanding one would either be a lie or block the import — so a row that cannot be
    attributed lands in review with no account, which is exactly where someone can decide whether to
    fill it in before logging or push it through as it stands.
    """
    from django.db import transaction as db_transaction
    from django.utils import timezone

    from apps.banking.models import BankAccount, BankTransaction
    from apps.budget.models import Category, Transaction, TransactionLine

    resolved, unmatched = resolve_payment_methods(budget, preview.cards, payment_method)
    categories = {c.name.strip().lower(): c for c in Category.objects.filter(budget=budget, is_system=False)}
    batch = uuid.uuid4().hex[:16]
    result = ImportResult(unmatched_cards=unmatched, skipped=list(preview.skipped), batch=batch)

    seen: dict[str, int] = {}
    accounts: dict[int, BankAccount] = {}

    with db_transaction.atomic():
        for row in preview.rows:
            method = resolved.get(row.card) or payment_method
            # Keyed on 0 for the unattributed bucket, since no payment method has that primary key.
            key = method.pk if method else 0
            if key not in accounts:
                accounts[key], _ = BankAccount.objects.get_or_create(
                    connection=None,
                    simplefin_id=(
                        f"import:payment-method:{method.pk}" if method else f"import:unassigned:budget:{budget.pk}"
                    ),
                    defaults={
                        "name": method.name if method else "Imported",
                        "org_name": "Imported",
                        "currency": user.currency or "USD",
                        "payment_method": method,
                        "budget": budget,
                    },
                )
            account = accounts[key]

            base = row_fingerprint(row, 0).rsplit(":", 1)[0]
            occurrence = seen.get(base, 0)
            seen[base] = occurrence + 1
            fingerprint = f"{base}:{occurrence}"

            posted = timezone.make_aware(datetime.datetime.combine(row.date, datetime.time.min))
            # Outflows negative, matching how SimpleFIN signs them, so bank_matching's direction
            # check reads an imported row the same way it reads a synced one.
            signed = row.amount if row.is_inflow else -row.amount

            bank_txn, created = BankTransaction.objects.get_or_create(
                bank_account=account,
                simplefin_id=fingerprint,
                defaults={
                    "posted_at": posted,
                    "amount": signed,
                    "description": row.description,
                    "payee": row.description[:255],
                    "memo": row.note,
                    "raw": {
                        "imported": True,
                        "import_batch": batch,
                        "card": row.card,
                        "bank_category": row.category,
                        "source_line": row.line_number,
                    },
                    "status": BankTransaction.Status.PENDING,
                },
            )
            if not created:
                result.duplicates += 1
                continue
            result.created += 1

            category = categories.get(row.category.strip().lower()) if row.category else None
            if not (auto_log and category):
                continue
            # Only when nothing already on the books looks like this row. Re-importing a file that
            # came from this budget would otherwise make a second copy of every transaction in it.
            already = Transaction.objects.filter(budget=budget, paid_date=row.date, lines__category=category).filter(
                lines__amount_usd=row.amount
            )
            if already.exists():
                continue

            txn = Transaction.objects.create(
                budget=budget,
                created_by=user,
                description=row.description or category.name,
                due_date=row.date,
                paid_date=row.date,
                transaction_type=category.category_type,
                payment_method=method,
                currency=user.currency or "USD",
            )
            # An auto-logged row still needs its account on the BankAccount so the budget link holds.
            TransactionLine.objects.create(transaction=txn, category=category, amount=row.amount, amount_usd=row.amount)
            bank_txn.transaction = txn
            bank_txn.status = BankTransaction.Status.LINKED
            # Marked so undoing the import can tell its own work from a transaction someone
            # categorised through review afterwards. Status alone cannot: both end up LINKED.
            bank_txn.raw = {**bank_txn.raw, "auto_logged": True}
            bank_txn.save(update_fields=["transaction", "status", "raw"])
            result.logged += 1

    return result
