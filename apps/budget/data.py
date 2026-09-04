"""Plain Python serialization helpers for passing model data to Inertia pages."""

import calendar
import datetime
from decimal import Decimal

from django.db.models import Case, CharField, F, Sum, When
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.budget.models import Category, CategoryBudget, Transaction, TransactionLine, add_months

# `Transaction.transaction_type` is blank on roughly one transaction in five, by design:
# `derive_transaction_type()` falls back to the first line's category type and the column is only
# written when something needs to override that (a goal deposit, which is stored as "transfer").
# Aggregate queries can't call that method, so filtering the raw column silently dropped every
# blank-type row — which is how four April paychecks went missing from the Income box while still
# showing in the income category rows below it, since those filter on the category instead.
#
# This is the SQL port of the same fallback, for use as `.alias(eff_type=EFF_TYPE).filter(...)`.
# It resolves per line rather than from the transaction's first line; the two differ only for a
# split whose lines straddle income and expense, where per-line is the more useful answer for a
# sum anyway.
EFF_TYPE = Case(
    When(transaction__transaction_type="", then=F("category__category_type")),
    default=F("transaction__transaction_type"),
    output_field=CharField(),
)


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
    ).alias(eff_type=EFF_TYPE).filter(eff_type__in=("income", "transfer")).aggregate(total=Sum("amount_usd"))[
        "total"
    ] or Decimal("0.00")
    expense = TransactionLine.objects.filter(
        transaction__budget=budget,
        category_id=category_id,
    ).alias(eff_type=EFF_TYPE).filter(eff_type="expense").aggregate(total=Sum("amount_usd"))["total"] or Decimal("0.00")
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
        # Only an imported row can be deleted. A synced one would reappear on the next sync, which is
        # why Ignore exists at all; nothing brings an imported row back, so Ignore would leave it as
        # permanent clutter.
        "is_imported": bt.bank_account.connection_id is None,
        "import_batch": (bt.raw or {}).get("import_batch", ""),
    }


def serialize_transaction(txn) -> dict:
    all_lines = list(txn.lines.all())
    lines = [serialize_transaction_line(line) for line in all_lines]
    # Sum the already-loaded lines in Python; txn.total_amount would re-aggregate
    # in the DB (ignoring the prefetch cache) and cause an N+1 across a txn list.
    total_amount = sum((line.amount for line in all_lines), Decimal("0.00"))
    linked_bt = getattr(txn, "bank_transaction", None) if txn.pk else None
    linked = [linked_bt] if linked_bt else []
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
    }


def serialize_recurring(rt) -> dict:
    # next_due_date_after already returns None once the schedule is past its end_date.
    next_due = rt.next_due_date_after(timezone.localdate() - datetime.timedelta(days=1))
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
        .alias(eff_type=EFF_TYPE)
        .exclude(eff_type="transfer")
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    activity_map: dict[int, Decimal] = {row["category_id"]: row["total"] * user_rate for row in expense_activity_qs}

    # Income activity for regular (non-goal) categories: bucketed by effective budget month
    # so income targeted at this month shows here even if it was received earlier/later.
    #
    # Filtered on the effective type as well as the category, so these rows sum to the Income
    # figure above them. Without it, a purchase misfiled into an income category was counted as
    # income here while the total correctly excluded it, and the two disagreed by that amount.
    income_activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=True,
            category__category_type=Category.TYPE_INCOME,
            transaction__paid_date__isnull=False,
        )
        .alias(eff_month=eff_month, eff_type=EFF_TYPE)
        .filter(eff_month=period_start, eff_type="income")
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
            transaction__paid_date__isnull=False,
        )
        .alias(eff_type=EFF_TYPE)
        .filter(eff_type="expense")
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
            transaction__paid_date__isnull=False,
        )
        .alias(eff_type=EFF_TYPE)
        .filter(eff_type__in=("income", "transfer"))
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
    goal_monthly_expense_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=False,
            transaction__paid_date__range=(period_start, period_end),
        )
        .alias(eff_type=EFF_TYPE)
        .filter(eff_type="expense")
        .aggregate(total=Sum("amount_usd"))
    )
    goal_monthly_spending = (goal_monthly_expense_qs["total"] or Decimal("0.00")) * user_rate

    # Saved to goals this month — money actually moved into a goal (paid only), by either route:
    # the Goals page writes transaction_type "transfer", a goal balance adjustment writes "income".
    #
    # Opening balances are excluded. They are savings that already existed when the goal was
    # created, so nothing moved and no month should show them leaving; they still give the goal its
    # balance through `saved_credits_qs` above, which deliberately does not filter them out.
    goal_transfers_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=False,
            transaction__paid_date__isnull=False,
            transaction__is_opening_balance=False,
        )
        .alias(eff_month=eff_month, eff_type=EFF_TYPE)
        .filter(eff_month=period_start, eff_type__in=("transfer", "income"))
        .aggregate(total=Sum("amount_usd"))
    )
    goal_transfers_month = (goal_transfers_qs["total"] or Decimal("0.00")) * user_rate

    # Total income this month — income-type lines landing in a non-goal category, bucketed by
    # effective budget month.
    #
    # Goal categories are excluded because a deposit into a goal is not new money: the paycheck it
    # came out of was already counted as income when it arrived, so counting the deposit again
    # inflated this figure by the amount moved. Both deposit routes land here — the Goals page
    # writes transaction_type "transfer", while a goal balance adjustment writes "income" — and it
    # is the *category* that identifies them, not the type. What leaves the assignable pool is
    # handled by `goal_transfers_month` below.
    income_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__goal__isnull=True,
            transaction__paid_date__isnull=False,
        )
        .alias(eff_month=eff_month, eff_type=EFF_TYPE)
        .filter(eff_month=period_start, eff_type="income")
        .aggregate(total=Sum("amount_usd"))
    )
    income_total = (income_qs["total"] or Decimal("0.00")) * user_rate

    categories = (
        Category.objects.filter(budget=budget, is_system=False).select_related("goal").order_by("category_type", "name")
    )

    # Rollover categories carry an unspent balance forward. `base_amount` is a *target*, not
    # funding: the money in the envelope is the carried balance plus whatever is assigned this
    # month, so
    #
    #     budgeted (target) = base + carry
    #     assigned (actual) = carry, or the stored figure once one exists for the month
    #     available         = assigned - spent
    #     carry to next     = max(0, available)
    #
    # The carried portion was already paid for out of an earlier month's income, so only
    # `assigned - carry` is charged to Ready to Assign. Assigning below the carry is how you
    # take money back out of the envelope, which makes that figure negative and returns it to
    # the pool. Only a positive leftover carries: an overspent month starts the next one at the
    # base with nothing carried.
    #
    # Each month's balance depends on that month's assignment, so the walk needs the assignment
    # history rather than just the selected month's.
    rollover_cats = [
        cat
        for cat in categories
        if cat.rollover
        and not cat.is_goal
        and cat.base_amount
        and cat.rollover_start
        and cat.rollover_start <= period_start
    ]
    assigned_history: dict[tuple[int, datetime.date], Decimal] = {}
    if rollover_cats:
        for row in CategoryBudget.objects.filter(
            budget=budget, category__in=rollover_cats, month__lte=period_start
        ).values("category_id", "month", "assigned"):
            assigned_history[(row["category_id"], row["month"])] = row["assigned"]

    rollover_info: dict[int, dict] = {}
    for cat in rollover_cats:
        start = cat.rollover_start
        base = cat.base_amount
        spend_by_month: dict[datetime.date, Decimal] = {}
        for row in (
            TransactionLine.objects.filter(
                transaction__budget=budget,
                category_id=cat.pk,
                transaction__paid_date__gte=start,
                transaction__paid_date__lte=period_end,
            )
            .alias(eff_type=EFF_TYPE)
            .filter(eff_type="expense")
            .annotate(m=TruncMonth("transaction__paid_date"))
            .values("m")
            .annotate(total=Sum("amount_usd"))
        ):
            spend_by_month[row["m"]] = row["total"] * user_rate

        balance = Decimal("0.00")
        carry = Decimal("0.00")
        budgeted = base
        assigned_this_month = Decimal("0.00")
        cursor = start
        while cursor <= period_start:
            carry = balance if balance > Decimal("0.00") else Decimal("0.00")
            budgeted = base + carry
            # No stored row means the carry is simply still sitting there. A stored row — even a
            # zero — is an explicit decision about how much the envelope holds this month.
            stored = assigned_history.get((cat.pk, cursor))
            assigned_this_month = carry if stored is None else stored
            balance = assigned_this_month - spend_by_month.get(cursor, Decimal("0.00"))
            cursor = add_months(cursor, 1)
        rollover_info[cat.pk] = {
            "budgeted": budgeted,
            "assigned": assigned_this_month,
            "carry": carry,
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
            budgeted = info["budgeted"]
            assigned = info["assigned"]
            available = info["available"]
            activity = info["activity"]
            # Only the part beyond the carried balance is funded from this month's income; the
            # carry was paid for by an earlier month. Assigning below the carry releases money
            # back, so this term is negative in that case — which is what lets Ready to Assign
            # exceed this month's income when you move a carried balance elsewhere.
            expense_assigned += assigned - info["carry"]
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
            "base_amount": str(cat.base_amount),
            "rollover_carry": (str(rollover_info[cat.pk]["carry"]) if cat.pk in rollover_info else None),
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

    # Ready to Assign is per-month: this month's income (by effective budget month) minus what has
    # been assigned out of it. Surplus is not carried forward automatically — to fund a future
    # month, target income at it via its budget month.
    #
    # Assignment is what commits money, for goals exactly as for any other category: a goal's
    # CategoryBudget row is already part of `expense_assigned`, and the deposit that follows moves
    # money inside the goal rather than out of the pool. So `goal_transfers_month` is not subtracted
    # here — doing both charged the same money twice, which only looked right while income_total was
    # inflated by the same deposits.
    #
    # One exception: releasing a rollover category's carried balance contributes a negative
    # assignment, so RTA can exceed this month's income by the amount released. That money was
    # funded by an earlier month and would otherwise be stranded.
    ready_to_assign = income_total - expense_assigned

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
