"""Plain Python serialization helpers for passing model data to Inertia pages."""
import calendar
import datetime
from decimal import Decimal

from django.db.models import Sum

from apps.budget.models import Category, CategoryBudget, Transaction, TransactionLine


def serialize_category(cat) -> dict:
    return {
        "id": cat.pk,
        "name": cat.name,
        "category_type": cat.category_type,
        "monthly_budget": str(cat.monthly_budget),
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


def serialize_transaction(txn) -> dict:
    lines = [serialize_transaction_line(line) for line in txn.lines.all()]
    # Recurring instances have no TransactionLine rows — synthesize one from the template.
    if not lines and txn.recurring_id:
        rt = txn.recurring
        lines = [
            {
                "id": None,
                "category": rt.category_id,
                "category_name": rt.category.name,
                "category_type": rt.category.category_type,
                "amount": str(rt.amount),
                "description": rt.name,
            }
        ]
    return {
        "id": txn.pk,
        "description": txn.description,
        "due_date": str(txn.due_date),
        "paid_date": str(txn.paid_date) if txn.paid_date else None,
        "is_paid": txn.is_paid,
        "notes": txn.notes,
        "recurring": txn.recurring_id,
        "payment_method": txn.payment_method_id,
        "payment_method_name": str(txn.payment_method) if txn.payment_method else None,
        "lines": lines,
        "total_amount": str(txn.total_amount),
        "transaction_type": txn.transaction_type,
        "created_at": txn.created_at.isoformat(),
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
        "gravatar_url": membership.user._get_gravatar_url(),
        "joined_at": membership.joined_at.isoformat(),
    }


def get_budget_overview(budget, month_str: str | None) -> dict:
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

    # Activity from transaction lines
    activity_qs = (
        TransactionLine.objects.filter(
            transaction__budget=budget,
            transaction__due_date__range=(period_start, period_end),
        )
        .values("category_id")
        .annotate(total=Sum("amount"))
    )
    activity_map: dict[int, Decimal] = {row["category_id"]: row["total"] for row in activity_qs}

    # Activity from paid recurring instances (no lines)
    recurring_activity_qs = (
        Transaction.objects.filter(
            budget=budget,
            due_date__range=(period_start, period_end),
            recurring__isnull=False,
            is_paid=True,
        )
        .values("recurring__category_id")
        .annotate(total=Sum("recurring__amount"))
    )
    for row in recurring_activity_qs:
        cat_id = row["recurring__category_id"]
        activity_map[cat_id] = activity_map.get(cat_id, Decimal("0.00")) + row["total"]

    # Assigned amounts
    assigned_qs = CategoryBudget.objects.filter(budget=budget, month=period_start).values("category_id", "assigned")
    assigned_map: dict[int, Decimal] = {row["category_id"]: row["assigned"] for row in assigned_qs}

    categories = Category.objects.filter(budget=budget).order_by("category_type", "name")

    rows = []
    income_total = Decimal("0.00")
    expense_assigned = Decimal("0.00")

    for cat in categories:
        activity = activity_map.get(cat.pk, Decimal("0.00"))
        assigned = assigned_map.get(cat.pk, Decimal("0.00"))
        if cat.category_type == Category.TYPE_INCOME:
            income_total += activity
            available = activity
        else:
            expense_assigned += assigned
            available = assigned - activity
        rows.append({
            "id": cat.pk,
            "name": cat.name,
            "category_type": cat.category_type,
            "budgeted": str(cat.monthly_budget),
            "assigned": str(assigned),
            "activity": str(activity),
            "available": str(available),
        })

    return {
        "income_total": str(income_total),
        "expense_assigned": str(expense_assigned),
        "ready_to_assign": str(income_total - expense_assigned),
        "categories": rows,
    }


def get_upcoming_transactions(budget) -> list:
    today = datetime.date.today()
    month_start = today.replace(day=1)
    month_end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    upcoming = (
        Transaction.objects.filter(
            budget=budget,
            recurring__isnull=False,
            is_paid=False,
            due_date__gte=month_start,
            due_date__lte=month_end,
        )
        .select_related("recurring__category", "payment_method")
        .prefetch_related("lines__category")
        .order_by("due_date")
    )
    return [serialize_transaction(t) for t in upcoming]
