"""
Suggest matches between an unlinked BankTransaction and local Transactions.

A "suggestion" is one of:
- {"kind": "transaction", ...}       — link to an existing unpaid Transaction
- {"kind": "recurring", ...}         — same, but the Transaction came from a RecurringTransaction
- {"kind": "paid_transaction", ...}  — link to an already-paid manual entry not yet bank-linked
- {"kind": "merchant_rule", ...}     — propose creating a new Transaction in a likely category

Confidence is in [0, 1]. Higher = better match. The caller decides how to present them.
"""

from __future__ import annotations

import datetime
from dataclasses import asdict, dataclass
from decimal import Decimal
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

from apps.budget.models import Category, Transaction

if TYPE_CHECKING:
    from apps.banking.models import BankTransaction
    from apps.budget.models import Budget


DATE_WINDOW_DAYS = 7
AMOUNT_TOLERANCE = Decimal("0.01")
MAX_SUGGESTIONS = 3


@dataclass
class Suggestion:
    kind: str
    confidence: float
    label: str
    sublabel: str
    transaction_id: int | None = None
    category_id: int | None = None
    category_name: str | None = None
    payment_method_id: int | None = None


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _name_similarity(bank_txn, *candidates: str) -> float:
    """Best similarity between bank_txn's payee/description and any of the given strings."""
    haystack = " ".join(c for c in candidates if c)
    if not haystack:
        return 0.0
    return max(
        _ratio(bank_txn.payee, haystack),
        _ratio(bank_txn.description, haystack),
    )


def _date_proximity(bank_date: datetime.date, candidate_date: datetime.date) -> float:
    """0..1 score: 1 when same day, fading to 0 at DATE_WINDOW_DAYS."""
    days = abs((bank_date - candidate_date).days)
    if days > DATE_WINDOW_DAYS:
        return 0.0
    return 1.0 - (days / (DATE_WINDOW_DAYS + 1))


def _amount_matches(a: Decimal, b: Decimal) -> bool:
    return abs(abs(a) - abs(b)) <= AMOUNT_TOLERANCE


def _direction_conflicts(bank_amount: Decimal, txn: Transaction) -> bool:
    """
    Report whether a bank row can't be the same movement of money as `txn`.

    SimpleFIN signs outflows negative, while local amounts are always stored positive with
    the direction carried by transaction_type. _amount_matches compares magnitudes only, so
    without this an incoming $50 paycheck would be offered as the match for a $50 card
    charge. Transfer-typed rows (goal deposits) and untyped transactions have no unambiguous
    direction, so they are never rejected here.
    """
    txn_type = txn.derive_transaction_type()
    if txn_type == Category.TYPE_INCOME:
        return bank_amount < 0
    if txn_type == Category.TYPE_EXPENSE:
        return bank_amount > 0
    return False


def suggest_matches(bank_txn: BankTransaction, budget: Budget) -> list[dict]:
    """Return up to MAX_SUGGESTIONS dicts ranked by confidence."""
    bank_date = bank_txn.posted_at.date()
    earliest = bank_date - datetime.timedelta(days=DATE_WINDOW_DAYS)
    latest = bank_date + datetime.timedelta(days=DATE_WINDOW_DAYS)
    amount = bank_txn.amount

    suggestions: list[Suggestion] = []

    # 1. Unpaid Transactions in window (covers both recurring instances and ad-hoc)
    candidates = (
        Transaction.objects.filter(
            budget=budget,
            paid_date__isnull=True,
            due_date__range=(earliest, latest),
        )
        .select_related("recurring__category", "payment_method")
        .prefetch_related("lines__category")
    )
    same_pm_filter = bank_txn.bank_account.payment_method_id
    for txn in candidates:
        txn_amount = txn.total_amount
        if not _amount_matches(amount, txn_amount) or _direction_conflicts(amount, txn):
            continue
        date_score = _date_proximity(bank_date, txn.due_date)
        # Name similarity: prefer recurring.name then description.
        names = [txn.description]
        if txn.recurring_id:
            names.append(txn.recurring.name)  # type: ignore[union-attr]
        name_score = _name_similarity(bank_txn, *names)
        pm_bonus = 0.1 if same_pm_filter and txn.payment_method_id == same_pm_filter else 0.0
        confidence = min(1.0, 0.55 * date_score + 0.35 * name_score + pm_bonus + 0.1)
        label = txn.recurring.name if txn.recurring_id else txn.description  # type: ignore[union-attr]
        sublabel = f"Due {txn.due_date.isoformat()} · {txn_amount}"
        kind = "recurring" if txn.recurring_id else "transaction"
        suggestions.append(
            Suggestion(
                kind=kind,
                confidence=confidence,
                label=label,
                sublabel=sublabel,
                transaction_id=txn.pk,
            )
        )

    # 1b. Already-paid Transactions in window with no bank link yet — covers the
    # "enter as you spend, bank confirms a day later" workflow. We use paid_date for
    # date proximity (vs. due_date for unpaid).
    paid_candidates = (
        Transaction.objects.filter(
            budget=budget,
            paid_date__range=(earliest, latest),
            bank_transaction__isnull=True,
        )
        .select_related("payment_method")
        .prefetch_related("lines__category")
    )
    for txn in paid_candidates:
        txn_amount = txn.total_amount
        if not _amount_matches(amount, txn_amount) or _direction_conflicts(amount, txn):
            continue
        date_score = _date_proximity(bank_date, txn.paid_date)
        name_score = _name_similarity(bank_txn, txn.description)
        pm_bonus = 0.1 if same_pm_filter and txn.payment_method_id == same_pm_filter else 0.0
        confidence = min(1.0, 0.55 * date_score + 0.35 * name_score + pm_bonus + 0.1)
        suggestions.append(
            Suggestion(
                kind="paid_transaction",
                confidence=confidence,
                label=txn.description,
                sublabel=f"Already recorded {txn.paid_date.isoformat()} · {txn_amount}",
                transaction_id=txn.pk,
            )
        )

    # 2. Merchant rule: if we've linked similar-looking BankTransactions to a category before,
    # propose creating a new Transaction in that category.
    from apps.banking.models import BankTransaction as BT  # avoid circular at module level

    history = (
        # An imported row has no connection, so no owner to narrow by; a synced one keeps the
        # narrowing it had, which is what stops a stranger's connection informing this budget.
        BT.objects.for_budget(budget, user=_owner_of(bank_txn))
        .filter(status=BT.Status.LINKED, transaction__budget=budget)
        .exclude(pk=bank_txn.pk)
        .select_related("transaction")
        .prefetch_related("transaction__lines__category")
        .order_by("-posted_at")[:200]
    )
    category_scores: dict[int, tuple[float, str]] = {}
    for past in history:
        sim = max(
            _ratio(past.payee or past.description, bank_txn.payee or bank_txn.description),
            _ratio(past.description, bank_txn.description),
        )
        if sim < 0.6:
            continue
        for line in past.transaction.lines.all():  # type: ignore[union-attr]
            # A system category is hidden from every user-facing category list, so proposing one
            # offers a destination the user could not have chosen themselves. This bites because
            # the retired confirm-as-transfer flow wrote its lines into the system "Transfers"
            # category, and that history still scores: "Create in Transfers — Suggested 85%".
            if line.category.is_system:
                continue
            existing = category_scores.get(line.category_id)
            if existing is None or sim > existing[0]:
                category_scores[line.category_id] = (sim, line.category.name)

    for cat_id, (sim, cat_name) in sorted(category_scores.items(), key=lambda kv: -kv[1][0])[:2]:
        suggestions.append(
            Suggestion(
                kind="merchant_rule",
                confidence=min(0.95, 0.55 + sim * 0.3),
                label=f"Create in {cat_name}",
                sublabel="Based on similar past transactions",
                category_id=cat_id,
                category_name=cat_name,
                payment_method_id=same_pm_filter,
            )
        )

    suggestions.sort(key=lambda s: -s.confidence)
    # Deduplicate: don't suggest the same transaction twice across kinds.
    seen_txn_ids: set[int] = set()
    deduped: list[Suggestion] = []
    for s in suggestions:
        if s.transaction_id is not None:
            if s.transaction_id in seen_txn_ids:
                continue
            seen_txn_ids.add(s.transaction_id)
        deduped.append(s)
        if len(deduped) >= MAX_SUGGESTIONS:
            break
    return [asdict(s) for s in deduped]


def _owner_of(bank_txn) -> object | None:
    """Return the user behind a synced row, or None for an imported one, which has no connection."""
    account = bank_txn.bank_account
    return account.connection.user if account.connection_id else None
