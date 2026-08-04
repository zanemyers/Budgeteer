"""Plain Python serialization helpers for passing model data to Inertia pages."""

import calendar
import datetime
from decimal import Decimal

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.budget.models import Category, CategoryBudget, Transaction, TransactionLine, add_months


def serialize_category(cat, total_saved: "Decimal | None" = None) -> dict:
    d = {
        "id": cat.pk,
        "name": cat.name,
        "category_type": cat.category_type,
        "parent_id": cat.parent_id,
        "monthly_budget": str(cat.monthly_budget),
        "rollover": cat.rollover,
        "base_amount": str(cat.base_amount),
        "rollover_start": cat.rollover_start.isoformat() if cat.rollover_start else None,
        "is_goal": cat.is_goal,
        "goal_target": str(cat.goal_target) if cat.goal_target is not None else None,
        "goal_due_date": str(cat.goal_due_date) if cat.goal_due_date else None,
        "goal_ongoing": cat.goal_ongoing,
        "goal_monthly": str(cat.goal_monthly) if cat.goal_monthly is not None else None,
    }
    if cat.is_goal:
        d["total_saved"] = str(total_saved) if total_saved is not None else "0.00"
    return d


def get_goal_total_saved(budget, category_id: int, user_rate: "Decimal" = Decimal("1")) -> "Decimal":
    """Compute all-time net saved for a goal category, converted to user's currency."""
    credits = TransactionLine.objects.filter(
        transaction__budget=budget,
        category_id=category_id,
        transaction__transaction_type__in=("income", "transfer"),
    ).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0.00")
    expense = TransactionLine.objects.filter(
        transaction__budget=budget,
        category_id=category_id,
        transaction__transaction_type="expense",
    ).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0.00")
    return (credits - expense) * user_rate


def serialize_pay_schedule(schedule) -> dict:
    return {
        "id": schedule.pk,
        "name": schedule.name,
        "category": schedule.category_id,
        "category_name": schedule.category.name if schedule.category else None,
        "payment_method": schedule.payment_method_id,
        "payment_method_name": str(schedule.payment_method) if schedule.payment_method else None,
        "frequency": schedule.frequency,
        "anchor_1": schedule.anchor_1,
        "anchor_2": schedule.anchor_2,
        "anchor_date": schedule.anchor_date.isoformat() if schedule.anchor_date else None,
        "allocation_offset_months": schedule.allocation_offset_months,
        "expected_amount": str(schedule.expected_amount) if schedule.expected_amount is not None else None,
        "match_text": schedule.match_text,
    }


def serialize_payment_method(pm) -> dict:
    return {
        "id": pm.pk,
        "name": pm.name,
        "payment_type": pm.payment_type,
        "payment_type_display": pm.get_payment_type_display(),
        "last_four": pm.last_four,
        "is_active": pm.is_active,
    }


def serialize_transaction_line(line) -> dict:
    return {
        "id": line.pk,
        "category": line.category_id,
        "category_name": line.category.name,
        "category_type": line.category.category_type,
        "amount": str(line.amount),
        "description": line.description,
    }


def serialize_bank_transaction(bt) -> dict:
    """
    Canonical serializer for a BankTransaction.

    Used everywhere the frontend needs bank-row data — linked-display in modals,
    the Pending/Ignored tabs on the Transactions page, and the Banking page.
    """
    return {
        "id": bt.pk,
        "simplefin_id": bt.simplefin_id,
        "posted_at": bt.posted_at.isoformat(),
        "posted_date": bt.posted_at.date().isoformat(),
        "amount": str(bt.amount),
        "description": bt.description,
        "payee": bt.payee,
        "memo": bt.memo,
        "status": bt.status,
        "ignore_reason": bt.ignore_reason,
        "transaction_id": bt.transaction_id,
        "bank_account_id": bt.bank_account_id,
        "bank_account_name": bt.bank_account.name,
        "org_name": bt.bank_account.org_name,
    }


def serialize_transaction(txn) -> dict:
    all_lines = list(txn.lines.all())
    lines = [serialize_transaction_line(line) for line in all_lines]
    # Sum the already-loaded lines in Python; txn.total_amount would re-aggregate
    # in the DB (ignoring the prefetch cache) and cause an N+1 across a txn list.
    total_amount = sum((line.amount for line in all_lines), Decimal("0.00"))
    linked_bt = getattr(txn, "bank_transaction", None) if txn.pk else None
    linked = [linked_bt] if linked_bt else []
    is_transfer = (
        txn.transaction_type == "transfer"
        or txn.transfer_partner_id is not None
        or any(line.category.is_system for line in all_lines)
    )
    return {
        "id": txn.pk,
        "description": txn.description,
        "due_date": str(txn.due_date),
        "paid_date": str(txn.paid_date) if txn.paid_date else None,
        "is_paid": txn.paid_date is not None,
        "budget_month": str(txn.budget_month) if txn.budget_month else None,
        "notes": txn.notes,
        "recurring": txn.recurring_id,
        "payment_method": txn.payment_method_id,
        "payment_method_name": str(txn.payment_method) if txn.payment_method else None,
        "lines": lines,
        "total_amount": str(total_amount),
        "transaction_type": txn.derive_transaction_type(),
        "currency": txn.currency,
        "exchange_rate_to_usd": str(txn.exchange_rate_to_usd),
        "created_at": txn.created_at.isoformat(),
        "bank_linked": bool(linked),
        "linked_bank_transactions": [serialize_bank_transaction(bt) for bt in linked],
        "transfer_partner_id": txn.transfer_partner_id,
        "is_transfer": is_transfer,
    }


def find_transfer_candidates(txn: Transaction, *, day_window: int = 3) -> list[Transaction]:
    """
    Return likely transfer-partner Transactions for `txn`.

    Match criteria: same budget, different payment_method, paid in opposite
    direction (one expense + one income/transfer), absolute total matches,
    paid/due dates within ±day_window. Self and already-linked candidates
    are excluded.
    """
    if not txn.pk:
        return []
    amount = abs(txn.total_amount)
    if amount == 0:
        return []
    anchor_date = txn.paid_date or txn.due_date
    window_start = anchor_date - datetime.timedelta(days=day_window)
    window_end = anchor_date + datetime.timedelta(days=day_window)

    txn_type = txn.derive_transaction_type()
    opposite_types = ("expense",) if txn_type in ("income", "transfer") else ("income", "transfer")

    candidates = (
        Transaction.objects.filter(budget_id=txn.budget_id)
        .exclude(pk=txn.pk)
        .filter(transfer_partner__isnull=True)
        .filter(
            Q(paid_date__range=(window_start, window_end))
            | Q(paid_date__isnull=True, due_date__range=(window_start, window_end))
        )
        .select_related("payment_method")
        .prefetch_related("lines__category")
    )
    if txn.payment_method_id:
        candidates = candidates.exclude(payment_method_id=txn.payment_method_id)

    matches: list[Transaction] = []
    for other in candidates:
        if abs(other.total_amount) != amount:
            continue
        if other.derive_transaction_type() not in opposite_types:
            continue
        matches.append(other)
    return matches


def find_pending_bank_transfer_candidates(bt, budget, *, day_window: int = 3) -> list:
    """
    Other pending BankTransactions that look like the matching leg of a transfer.

    Same |amount|, opposite sign, ±day_window from this bank txn's posted date,
    different bank account, both still pending (neither yet promoted to a budget
    Transaction). Bank account must be mapped into the same budget.
    """
    from apps.banking.models import BankTransaction

    amount = abs(bt.amount)
    if amount == 0:
        return []
    posted = bt.posted_at.date()
    qs = (
        BankTransaction.objects.filter(
            bank_account__connection__user_id=bt.bank_account.connection.user_id,
            bank_account__payment_method__budget=budget,
            status=BankTransaction.Status.PENDING,
            posted_at__date__range=(
                posted - datetime.timedelta(days=day_window),
                posted + datetime.timedelta(days=day_window),
            ),
        )
        .exclude(pk=bt.pk)
        .exclude(bank_account_id=bt.bank_account_id)
        .select_related("bank_account")
    )
    return [other for other in qs if abs(other.amount) == amount and (other.amount > 0) != (bt.amount > 0)]


def find_transfer_candidates_for_bank_txn(bt, budget, *, day_window: int = 3) -> list[Transaction]:
    """
    Like find_transfer_candidates but for an as-yet-unconfirmed BankTransaction.

    Determines direction from the signed bank amount (negative = outflow, treat
    like expense; positive = inflow, treat like income/transfer).
    """
    amount = abs(bt.amount)
    if amount == 0:
        return []
    posted = bt.posted_at.date()
    window_start = posted - datetime.timedelta(days=day_window)
    window_end = posted + datetime.timedelta(days=day_window)
    bank_pm_id = bt.bank_account.payment_method_id

    # Outflow bank rows pair with income/transfer-type Transactions and vice versa.
    opposite_types = ("income", "transfer") if bt.amount < 0 else ("expense",)

    candidates = (
        Transaction.objects.filter(budget=budget)
        .filter(transfer_partner__isnull=True)
        .filter(
            Q(paid_date__range=(window_start, window_end))
            | Q(paid_date__isnull=True, due_date__range=(window_start, window_end))
        )
        .select_related("payment_method")
        .prefetch_related("lines__category")
    )
    if bank_pm_id:
        candidates = candidates.exclude(payment_method_id=bank_pm_id)

    matches: list[Transaction] = []
    for other in candidates:
        if abs(other.total_amount) != amount:
            continue
        if other.derive_transaction_type() not in opposite_types:
            continue
        matches.append(other)
    return matches


def serialize_recurring(rt) -> dict:
    next_due = rt.next_due_date_after(timezone.localdate() - datetime.timedelta(days=1)) if rt.is_active else None
    return {
        "id": rt.pk,
        "name": rt.name,
        "description": rt.description,
        "amount": str(rt.amount),
        "category": rt.category_id,
        "category_name": rt.category.name,
        "category_type": rt.category.category_type,
        "payment_method": rt.payment_method_id,
        "payment_method_name": str(rt.payment_method) if rt.payment_method else None,
        "frequency": rt.frequency,
        "interval": rt.interval,
        "start_date": str(rt.start_date),
        "end_date": str(rt.end_date) if rt.end_date else None,
        "is_active": rt.is_active,
        "generated_through": str(rt.generated_through) if rt.generated_through else None,
        "next_due_date": str(next_due) if next_due else None,
        "created_at": rt.created_at.isoformat(),
    }


def serialize_membership(membership) -> dict:
    return {
        "id": membership.pk,
        "user": membership.user_id,
        "email": membership.user.email,
        "name": membership.user.get_full_name() or membership.user.email,
        "role": membership.role,
        "gravatar_url": membership.user.avatar_url,
        "joined_at": membership.joined_at.isoformat(),
    }


def get_budget_overview(budget, month_str: str | None, user_rate: "Decimal" = Decimal("1")) -> dict:
    """Compute the YNAB-style budget overview for a given month."""
    try:
        selected = datetime.date.fromisoformat(month_str + "-01") if month_str else timezone.localdate().replace(day=1)
    except (ValueError, TypeError, AttributeError):
        selected = timezone.localdate().replace(day=1)

    last_day = calendar.monthrange(selected.year, selected.month)[1]
    period_start = selected
    period_end = selected.replace(day=last_day)

    # Effective budget month for a line: the transaction's budget_month override if set
    # (income targeted at a future month), otherwise the month of its paid_date. Since
    # budget_month is only ever set on income, transfers/expenses fall back to paid_date.
    eff_month = Coalesce("transaction__budget_month", TruncMonth("transaction__paid_date"))

    # Expense activity for regular (non-goal) categories: only paid transactions count,
    # bucketed by paid_date. Amounts stored as amount_usd; scaled to user currency below.
    expense_activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=True,
            category__category_type=Category.TYPE_EXPENSE,
            transaction__paid_date__range=(period_start, period_end),
        )
        .exclude(transaction__transaction_type="transfer")
        .exclude(transaction__transfer_partner__isnull=False)
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    activity_map: dict[int, Decimal] = {row["category_id"]: row["total"] * user_rate for row in expense_activity_qs}

    # Income activity for regular (non-goal) categories: bucketed by effective budget month
    # so income targeted at this month shows here even if it was received earlier/later.
    income_activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=True,
            category__category_type=Category.TYPE_INCOME,
            transaction__paid_date__isnull=False,
        )
        .exclude(transaction__transfer_partner__isnull=False)
        .alias(eff_month=eff_month)
        .filter(eff_month=period_start)
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    for row in income_activity_qs:
        activity_map[row["category_id"]] = row["total"] * user_rate

    # All-time paid expenses per goal category. Reused below for the net-saved
    # balance, so compute this (identical) aggregate once.
    goal_expense_map: dict[int, Decimal] = {
        row["category_id"]: row["total"] * user_rate
        for row in TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=False,
            transaction__transaction_type="expense",
            transaction__paid_date__isnull=False,
        )
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    }
    # A goal category's activity is its all-time paid expense total (no date filter).
    activity_map.update(goal_expense_map)

    # Assigned amounts
    assigned_qs = CategoryBudget.objects.filter(budget=budget, month=period_start).values("category_id", "assigned")
    assigned_map: dict[int, Decimal] = {row["category_id"]: row["assigned"] for row in assigned_qs}

    # All-time net balance per goal category (paid only): transfers/income add, expense lines subtract
    saved_credits_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=False,
            transaction__transaction_type__in=("income", "transfer"),
            transaction__paid_date__isnull=False,
        )
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    credits_map: dict[int, Decimal] = {}
    for row in saved_credits_qs:
        credits_map[row["category_id"]] = (
            credits_map.get(row["category_id"], Decimal("0.00")) + row["total"] * user_rate
        )

    saved_map: dict[int, Decimal] = dict(credits_map)
    for cat_id, expense_total in goal_expense_map.items():
        saved_map[cat_id] = saved_map.get(cat_id, Decimal("0.00")) - expense_total

    # Monthly SF spending (paid expenses only) for dashboard totals
    goal_monthly_expense_qs = TransactionLine.objects.filter(
        transaction__budget=budget,
        category__goal__isnull=False,
        transaction__transaction_type="expense",
        transaction__paid_date__range=(period_start, period_end),
    ).aggregate(total=Sum("amount_usd"))
    goal_monthly_spending = (goal_monthly_expense_qs["total"] or Decimal("0.00")) * user_rate

    # Saved to goals this month — any income or transfer line landing in a goal (paid only).
    # Income-to-goal counts here so the dashboard reflects it; net effect on RTA is zero because
    # income-type lines also appear in income_total below.
    goal_transfers_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            transaction__transaction_type__in=("transfer", "income"),
            category__goal__isnull=False,
            transaction__paid_date__isnull=False,
        )
        .alias(eff_month=eff_month)
        .filter(eff_month=period_start)
        .aggregate(total=Sum("amount_usd"))
    )
    goal_transfers_month = (goal_transfers_qs["total"] or Decimal("0.00")) * user_rate

    # Total income this month — any income-type line, regardless of which category it lands in,
    # bucketed by effective budget month. An income line to a goal category counts here AND in
    # goal_transfers_month, so net RTA = 0 for income that went straight to a goal.
    income_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            transaction__transaction_type="income",
            transaction__paid_date__isnull=False,
        )
        .exclude(transaction__transfer_partner__isnull=False)
        .alias(eff_month=eff_month)
        .filter(eff_month=period_start)
        .aggregate(total=Sum("amount_usd"))
    )
    income_total = (income_qs["total"] or Decimal("0.00")) * user_rate

    categories = (
        Category.objects.filter(budget=budget, is_system=False).select_related("goal").order_by("category_type", "name")
    )

    # Rollover categories are budgeted a recurring base each month (from rollover_start). Only a
    # *positive* leftover carries forward — a month that ends at zero or overspent resets to just the
    # base next month (no negative carryover). This needs a month-by-month walk, so we fetch spending
    # per month and iterate the running balance.
    rollover_info: dict[int, dict] = {}
    for cat in categories:
        if not (cat.rollover and not cat.is_goal and cat.base_amount and cat.rollover_start):
            continue
        if cat.rollover_start > period_start:
            continue  # not accruing yet for this month
        start = cat.rollover_start
        base = cat.base_amount
        spend_by_month: dict[datetime.date, Decimal] = {}
        for row in (
            TransactionLine.objects.filter(
                transaction__budget=budget,
                category_id=cat.pk,
                transaction__transaction_type="expense",
                transaction__paid_date__gte=start,
                transaction__paid_date__lte=period_end,
            )
            .exclude(transaction__transfer_partner__isnull=False)
            .annotate(m=TruncMonth("transaction__paid_date"))
            .values("m")
            .annotate(total=Sum("amount_usd"))
        ):
            spend_by_month[row["m"]] = row["total"] * user_rate

        balance = Decimal("0.00")
        budgeted = base
        cursor = start
        while cursor <= period_start:
            carry = balance if balance > Decimal("0.00") else Decimal("0.00")
            budgeted = base + carry  # this month's budgeted target = base + positive leftover only
            balance = budgeted - spend_by_month.get(cursor, Decimal("0.00"))
            cursor = add_months(cursor, 1)
        rollover_info[cat.pk] = {
            "budgeted": budgeted,
            "available": balance,
            "activity": spend_by_month.get(period_start, Decimal("0.00")),
        }

    rows = []
    expense_assigned = Decimal("0.00")

    today = timezone.localdate()

    for cat in categories:
        activity = activity_map.get(cat.pk, Decimal("0.00"))
        assigned = assigned_map.get(cat.pk, Decimal("0.00"))

        # Compute goal monthly needed
        goal_monthly_needed = None
        months_remaining = None
        total_saved = None
        if cat.is_goal and cat.goal_target:
            total_saved = saved_map.get(cat.pk, Decimal("0.00"))
            if cat.goal_ongoing and cat.goal_monthly:
                goal_monthly_needed = cat.goal_monthly
            elif cat.goal_due_date:
                remaining_amount = max(cat.goal_target - total_saved, Decimal("0.00"))
                due = cat.goal_due_date
                months_remaining = max((due.year - today.year) * 12 + (due.month - today.month), 1)
                goal_monthly_needed = (remaining_amount / months_remaining).quantize(Decimal("0.01"))

        budgeted = cat.monthly_budget
        if cat.category_type == Category.TYPE_INCOME:
            available = activity
        elif cat.pk in rollover_info:
            info = rollover_info[cat.pk]
            # The base auto-sets the BUDGETED target (base + carryover) and the running available
            # balance. It does NOT assign from Ready to Assign — RTA is untouched by rollover.
            budgeted = info["budgeted"]
            available = info["available"]
            activity = info["activity"]
            assigned = Decimal("0.00")
        else:
            expense_assigned += assigned
            available = assigned - activity

        row: dict = {
            "id": cat.pk,
            "name": cat.name,
            "category_type": cat.category_type,
            "parent_id": cat.parent_id,
            "budgeted": str(budgeted),
            "assigned": str(assigned),
            "activity": str(activity),
            "available": str(available),
            "rollover": cat.rollover,
            "is_goal": cat.is_goal,
            "goal_target": str(cat.goal_target) if cat.goal_target is not None else None,
            "goal_due_date": str(cat.goal_due_date) if cat.goal_due_date else None,
            "goal_ongoing": cat.goal_ongoing,
            "goal_monthly_needed": str(goal_monthly_needed) if goal_monthly_needed is not None else None,
            "goal_monthly": str(cat.goal_monthly) if cat.goal_monthly is not None else None,
            "goal_months_remaining": months_remaining,
            "goal_total_saved": str(total_saved) if total_saved is not None else None,
            "goal_total_credited": str(credits_map.get(cat.pk, Decimal("0.00"))) if cat.is_goal else None,
        }
        rows.append(row)

    # Ready to Assign is per-month: this month's income (by effective budget month) minus what's
    # been assigned and saved to goals this month. Surplus is not carried forward automatically —
    # to fund a future month, target income at it via its budget month.
    ready_to_assign = income_total - expense_assigned - goal_transfers_month

    return {
        "income_total": str(income_total),
        "expense_assigned": str(expense_assigned),
        "saved_to_goals_total": str(goal_transfers_month),
        "goal_monthly_spending": str(goal_monthly_spending),
        "ready_to_assign": str(ready_to_assign),
        "categories": rows,
    }


def get_upcoming_transactions(budget) -> list:
    today = timezone.localdate()
    week_out = today + datetime.timedelta(days=7)
    upcoming = (
        Transaction.objects.filter(
            budget=budget,
            recurring__isnull=False,
            paid_date__isnull=True,
            due_date__lte=week_out,
        )
        .select_related("recurring__category", "payment_method")
        .prefetch_related("lines__category")
        .order_by("due_date")
    )
    return [serialize_transaction(t) for t in upcoming]


def get_pending_count(budget, month_str: str | None) -> int:
    """
    Count transactions in the given month that need user review.

    Mirrors the Transactions page's Pending section logic: a transaction is
    pending if it has no paid_date OR if it's recurring and not yet marked paid.
    Month scoping uses Coalesce(paid_date, due_date), matching TransactionListView.
    """
    try:
        month_start = (
            datetime.date.fromisoformat(month_str + "-01") if month_str else timezone.localdate().replace(day=1)
        )
    except (ValueError, TypeError, AttributeError):
        month_start = timezone.localdate().replace(day=1)
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    month_end = month_start.replace(day=last_day)

    return (
        Transaction.objects.filter(budget=budget)
        .annotate(effective_date=Coalesce("paid_date", "due_date"))
        .filter(effective_date__range=(month_start, month_end))
        .filter(paid_date__isnull=True)
        .count()
    )
