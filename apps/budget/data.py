"""Plain Python serialization helpers for passing model data to Inertia pages."""
import calendar
import datetime
from decimal import Decimal

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce

from apps.budget.models import Category, CategoryBudget, Transaction, TransactionLine


def serialize_category(cat, total_saved: "Decimal | None" = None) -> dict:
    d = {
        "id": cat.pk,
        "name": cat.name,
        "category_type": cat.category_type,
        "parent_id": cat.parent_id,
        "monthly_budget": str(cat.monthly_budget),
        "is_sinking_fund": cat.is_sinking_fund,
        "sinking_fund_target": str(cat.sinking_fund_target) if cat.sinking_fund_target is not None else None,
        "sinking_fund_due_date": str(cat.sinking_fund_due_date) if cat.sinking_fund_due_date else None,
        "sinking_fund_ongoing": cat.sinking_fund_ongoing,
        "sinking_fund_monthly_goal": str(cat.sinking_fund_monthly_goal) if cat.sinking_fund_monthly_goal is not None else None,
    }
    if cat.is_sinking_fund:
        d["total_saved"] = str(total_saved) if total_saved is not None else "0.00"
    return d


def get_sf_total_saved(budget, category_id: int, user_rate: "Decimal" = Decimal("1")) -> "Decimal":
    """Compute all-time net saved for a sinking fund category, converted to user's currency."""
    credits = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category_id=category_id,
            transaction__transaction_type__in=("income", "transfer"),
        ).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0.00")
    )
    expense = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category_id=category_id,
            transaction__transaction_type="expense",
        ).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0.00")
    )
    return (credits - expense) * user_rate


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


def serialize_linked_bank_transaction(bt) -> dict:
    return {
        "id": bt.pk,
        "posted_date": bt.posted_at.date().isoformat(),
        "amount": str(bt.amount),
        "description": bt.description,
        "payee": bt.payee,
        "memo": bt.memo,
        "bank_account_name": bt.bank_account.name,
        "org_name": bt.bank_account.org_name,
    }


def serialize_transaction(txn) -> dict:
    lines = [serialize_transaction_line(line) for line in txn.lines.all()]
    linked_bt = getattr(txn, "bank_transaction", None) if txn.pk else None
    linked = [linked_bt] if linked_bt else []
    return {
        "id": txn.pk,
        "description": txn.description,
        "due_date": str(txn.due_date),
        "paid_date": str(txn.paid_date) if txn.paid_date else None,
        "is_paid": txn.paid_date is not None,
        "notes": txn.notes,
        "recurring": txn.recurring_id,
        "payment_method": txn.payment_method_id,
        "payment_method_name": str(txn.payment_method) if txn.payment_method else None,
        "lines": lines,
        "total_amount": str(txn.total_amount),
        "transaction_type": txn.derive_transaction_type(),
        "currency": txn.currency,
        "exchange_rate_to_usd": str(txn.exchange_rate_to_usd),
        "created_at": txn.created_at.isoformat(),
        "bank_linked": bool(linked),
        "linked_bank_transactions": [serialize_linked_bank_transaction(bt) for bt in linked],
    }


def serialize_recurring(rt) -> dict:
    next_due = rt.next_due_date_after(datetime.date.today() - datetime.timedelta(days=1)) if rt.is_active else None
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
        selected = (
            datetime.date.fromisoformat(month_str + "-01")
            if month_str
            else datetime.date.today().replace(day=1)
        )
    except (ValueError, TypeError, AttributeError):
        selected = datetime.date.today().replace(day=1)

    last_day = calendar.monthrange(selected.year, selected.month)[1]
    period_start = selected
    period_end = selected.replace(day=last_day)

    # Activity for regular (non-SF) categories: all transactions except transfers.
    # Amounts stored as amount_usd (USD equivalent at transaction time); scaled to user currency below.
    regular_activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__sinking_fund__isnull=True,
        )
        .exclude(transaction__transaction_type="transfer")
        .annotate(effective_date=Coalesce("transaction__paid_date", "transaction__due_date"))
        .filter(effective_date__range=(period_start, period_end))
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    activity_map: dict[int, Decimal] = {row["category_id"]: row["total"] * user_rate for row in regular_activity_qs}

    # Activity for sinking fund categories: all-time expense total (no date filter).
    sf_activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__sinking_fund__isnull=False,
            transaction__transaction_type="expense",
        )
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    for row in sf_activity_qs:
        activity_map[row["category_id"]] = row["total"] * user_rate

    # Assigned amounts
    assigned_qs = CategoryBudget.objects.filter(budget=budget, month=period_start).values("category_id", "assigned")
    assigned_map: dict[int, Decimal] = {row["category_id"]: row["assigned"] for row in assigned_qs}

    # All-time net balance per sinking fund category: transfers/income add, expense lines subtract
    saved_credits_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__sinking_fund__isnull=False,
            transaction__transaction_type__in=("income", "transfer"),
        )
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    saved_expense_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__sinking_fund__isnull=False,
            transaction__transaction_type="expense",
        )
        .values("category_id")
        .annotate(total=Sum("amount_usd"))
    )
    credits_map: dict[int, Decimal] = {}
    for row in saved_credits_qs:
        credits_map[row["category_id"]] = credits_map.get(row["category_id"], Decimal("0.00")) + row["total"] * user_rate

    saved_map: dict[int, Decimal] = dict(credits_map)
    for row in saved_expense_qs:
        saved_map[row["category_id"]] = saved_map.get(row["category_id"], Decimal("0.00")) - row["total"] * user_rate

    # Monthly SF spending (expenses only, date-filtered) for dashboard totals
    sf_monthly_expense_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            category__sinking_fund__isnull=False,
            transaction__transaction_type="expense",
        )
        .annotate(effective_date=Coalesce("transaction__paid_date", "transaction__due_date"))
        .filter(effective_date__range=(period_start, period_end))
        .aggregate(total=Sum("amount_usd"))
    )
    sf_monthly_spending = (sf_monthly_expense_qs["total"] or Decimal("0.00")) * user_rate

    # Transfers to sinking funds this month — subtracted from RTA
    sf_transfers_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            transaction__transaction_type="transfer",
            category__sinking_fund__isnull=False,
        )
        .annotate(effective_date=Coalesce("transaction__paid_date", "transaction__due_date"))
        .filter(effective_date__range=(period_start, period_end))
        .aggregate(total=Sum("amount_usd"))
    )
    sf_transfers_month = (sf_transfers_qs["total"] or Decimal("0.00")) * user_rate

    categories = Category.objects.filter(budget=budget).order_by("category_type", "name")

    rows = []
    income_total = Decimal("0.00")
    expense_assigned = Decimal("0.00")

    today = datetime.date.today()

    for cat in categories:
        activity = activity_map.get(cat.pk, Decimal("0.00"))
        assigned = assigned_map.get(cat.pk, Decimal("0.00"))

        # Compute sinking fund monthly needed
        sinking_fund_monthly = None
        months_remaining = None
        total_saved = None
        if cat.is_sinking_fund and cat.sinking_fund_target:
            total_saved = saved_map.get(cat.pk, Decimal("0.00"))
            if cat.sinking_fund_ongoing and cat.sinking_fund_monthly_goal:
                sinking_fund_monthly = cat.sinking_fund_monthly_goal
            elif cat.sinking_fund_due_date:
                remaining_amount = max(cat.sinking_fund_target - total_saved, Decimal("0.00"))
                due = cat.sinking_fund_due_date
                months_remaining = max((due.year - today.year) * 12 + (due.month - today.month), 1)
                sinking_fund_monthly = (remaining_amount / months_remaining).quantize(Decimal("0.01"))

        if cat.category_type == Category.TYPE_INCOME:
            income_total += activity
            available = activity
        else:
            expense_assigned += assigned
            available = assigned - activity

        row: dict = {
            "id": cat.pk,
            "name": cat.name,
            "category_type": cat.category_type,
            "parent_id": cat.parent_id,
            "budgeted": str(cat.monthly_budget),
            "assigned": str(assigned),
            "activity": str(activity),
            "available": str(available),
            "is_sinking_fund": cat.is_sinking_fund,
            "sinking_fund_target": str(cat.sinking_fund_target) if cat.sinking_fund_target is not None else None,
            "sinking_fund_due_date": str(cat.sinking_fund_due_date) if cat.sinking_fund_due_date else None,
            "sinking_fund_ongoing": cat.sinking_fund_ongoing,
            "sinking_fund_monthly": str(sinking_fund_monthly) if sinking_fund_monthly is not None else None,
            "sinking_fund_monthly_goal": str(cat.sinking_fund_monthly_goal) if cat.sinking_fund_monthly_goal is not None else None,
            "sinking_fund_months_remaining": months_remaining,
            "sinking_fund_total_saved": str(total_saved) if total_saved is not None else None,
            "sinking_fund_total_credited": str(credits_map.get(cat.pk, Decimal("0.00"))) if cat.is_sinking_fund else None,
        }
        rows.append(row)

    return {
        "income_total": str(income_total),
        "expense_assigned": str(expense_assigned),
        "transfers_total": str(sf_transfers_month),
        "sf_monthly_spending": str(sf_monthly_spending),
        "ready_to_assign": str(income_total - expense_assigned - sf_transfers_month),
        "categories": rows,
    }


def get_upcoming_transactions(budget) -> list:
    today = datetime.date.today()
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
    """Count transactions in the given month that need user review.

    Mirrors the Transactions page's Pending section logic: a transaction is
    pending if it has no paid_date OR if it's recurring and not yet marked paid.
    Month scoping uses Coalesce(paid_date, due_date), matching TransactionListView.
    """
    try:
        month_start = datetime.date.fromisoformat(month_str + "-01") if month_str else datetime.date.today().replace(day=1)
    except (ValueError, TypeError, AttributeError):
        month_start = datetime.date.today().replace(day=1)
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    month_end = month_start.replace(day=last_day)

    return (
        Transaction.objects.filter(budget=budget)
        .annotate(effective_date=Coalesce("paid_date", "due_date"))
        .filter(effective_date__range=(month_start, month_end))
        .filter(paid_date__isnull=True)
        .count()
    )
