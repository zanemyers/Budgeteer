import calendar
import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings as django_settings
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import IntegrityError, transaction as db_transaction
from django.db.models import ProtectedError, Q
from django.db.models.functions import Coalesce
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse, reverse_lazy
from django.views import View
from django.views import generic

from inertia import render as inertia_render

from apps.budget.data import (
    find_pending_bank_transfer_candidates,
    find_transfer_candidates,
    find_transfer_candidates_for_bank_txn,
    get_budget_overview,
    get_goal_total_saved,
    get_pending_count,
    serialize_bank_transaction,
    serialize_category,
    serialize_membership,
    serialize_payment_method,
    serialize_recurring,
    serialize_transaction,
)
from apps.budget.models import (
    Budget,
    BudgetMembership,
    Category,
    CategoryBudget,
    PaymentMethod,
    RecurringTransaction,
    Goal,
    Transaction,
    TransactionLine,
)
from apps.accounts.models import User
from apps.banking.models import BankTransaction
from apps.base.http import parse_json_body
from apps.base.models import Currency as CurrencyModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_month() -> str:
    today = datetime.date.today()
    return f"{today.year}-{today.month:02d}"


def _get_user_currency_rate(user) -> Decimal:
    try:
        return CurrencyModel.objects.get(code=user.currency or "USD").rate_to_usd
    except CurrencyModel.DoesNotExist:
        return Decimal("1")


def _serialize_currencies():
    return list(CurrencyModel.objects.values("code", "name", "symbol"))


# ---------------------------------------------------------------------------
# Mixins
# ---------------------------------------------------------------------------


class BudgetMemberMixin(LoginRequiredMixin):
    """Verify the requesting user is a member of the budget identified by budget_pk."""

    budget: Budget

    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return super().dispatch(request, *args, **kwargs)
        budget_pk = kwargs.get("budget_pk")
        try:
            self.budget = Budget.objects.get(pk=budget_pk)
        except Budget.DoesNotExist:
            raise Http404
        if not self.budget.members.filter(pk=request.user.pk).exists():
            raise Http404
        self.check_budget_permissions(request)
        if request.user.last_viewed_budget_id != self.budget.pk:
            request.user.last_viewed_budget_id = self.budget.pk
            request.user.save(update_fields=["last_viewed_budget"])
        return super().dispatch(request, *args, **kwargs)

    def check_budget_permissions(self, request):
        """Hook for subclasses to add extra permission checks after self.budget is set."""


class BudgetOwnerMixin(BudgetMemberMixin):
    """Restrict to budget owners only."""

    def check_budget_permissions(self, request):
        is_owner = BudgetMembership.objects.filter(
            budget=self.budget, user=request.user, role=BudgetMembership.ROLE_OWNER
        ).exists()
        if not is_owner:
            raise Http404


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


class PaymentMethodsView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = parse_json_body(request)
        name = data.get("name", "").strip()
        payment_type = data.get("payment_type", PaymentMethod.TYPE_OTHER)
        last_four = data.get("last_four", "").strip()[:4]
        if not name:
            return JsonResponse({"errors": {"name": ["Name is required."]}}, status=400)
        pm = PaymentMethod.objects.create(
            budget=self.budget,
            name=name,
            payment_type=payment_type,
            last_four=last_four,
            is_active=True,
        )
        return JsonResponse(serialize_payment_method(pm), status=201)


class PaymentMethodDetailView(BudgetMemberMixin, View):
    def _get(self, pk):
        return get_object_or_404(PaymentMethod, pk=pk, budget=self.budget)

    def patch(self, request, budget_pk, pk):
        pm = self._get(pk)
        data = parse_json_body(request)
        for field in ("name", "payment_type", "last_four", "is_active"):
            if field in data:
                setattr(pm, field, data[field])
        pm.save()
        return JsonResponse(serialize_payment_method(pm))

    def delete(self, request, budget_pk, pk):
        self._get(pk).delete()
        return JsonResponse({}, status=204)


class BudgetHistoryView(LoginRequiredMixin, View):
    def get(self, request):
        from django.db.models.functions import TruncMonth

        budgets = list(Budget.objects.filter(members=request.user).order_by("-created_at"))
        # Default budget always pinned to the top.
        default_id = request.user.default_budget_id
        if default_id:
            budgets.sort(key=lambda b: 0 if b.pk == default_id else 1)
        result = []
        for budget in budgets:
            # Months with actual recorded activity — paid transactions only.
            # Future recurring stubs (unpaid, auto-generated) are excluded so the
            # archive reflects what really happened, not what's scheduled.
            month_qs = list(
                Transaction.objects.filter(budget=budget, paid_date__isnull=False)
                .annotate(month=TruncMonth("paid_date"))
                .values("month")
                .distinct()
                .order_by("-month")
            )
            result.append({
                "id": budget.pk,
                "name": budget.name or f"Budget #{budget.pk}",
                "months": [m["month"].strftime("%Y-%m") for m in month_qs],
                "is_default": budget.pk == default_id,
            })
        return inertia_render(request, "BudgetHistory", {"budgets": result})


class BudgetHomeView(LoginRequiredMixin, View):
    """Redirect to the user's default budget, or their first budget, creating one if needed."""

    def get(self, request):
        user = request.user
        budget = None
        if user.default_budget_id and Budget.objects.filter(pk=user.default_budget_id, members=user).exists():
            budget = user.default_budget
        if not budget:
            budget = Budget.objects.filter(members=user).first()
        if not budget:
            budget = Budget.objects.create(created_by=user)
            BudgetMembership.objects.create(budget=budget, user=user, role=BudgetMembership.ROLE_OWNER)
        return redirect(reverse("budget:detail", kwargs={"budget_pk": budget.pk}))


class BudgetListView(LoginRequiredMixin, View):
    def get(self, request):
        budgets = list(Budget.objects.filter(members=request.user).order_by("-created_at"))
        membership_map = {
            m.budget_id: m.role
            for m in BudgetMembership.objects.filter(budget__in=budgets, user=request.user)
        }
        default_id = request.user.default_budget_id
        # Default budget always pinned to the top.
        if default_id:
            budgets.sort(key=lambda b: 0 if b.pk == default_id else 1)
        return inertia_render(request, "BudgetList", {
            "budgets": [
                {
                    "id": b.pk,
                    "name": b.name,
                    "created_at": b.created_at.isoformat(),
                    "is_owner": membership_map.get(b.pk) == BudgetMembership.ROLE_OWNER,
                    "is_default": b.pk == default_id,
                }
                for b in budgets
            ],
        })


class BudgetSetDefaultView(LoginRequiredMixin, View):
    def post(self, request, budget_pk):
        budget = get_object_or_404(Budget, pk=budget_pk, members=request.user)
        request.user.default_budget = budget
        request.user.save(update_fields=["default_budget"])
        return JsonResponse({"default_budget": budget.pk})


DEFAULT_CATEGORIES: list[tuple[str, str, list[str]]] = [
    # (type, parent name, [subcategory names])
    ("income", "Salary", []),
    ("income", "Other Income", []),
    ("expense", "Housing", ["Rent/Mortgage", "Utilities", "Internet", "Phone"]),
    ("expense", "Food", ["Groceries", "Dining Out"]),
    ("expense", "Transportation", ["Gas", "Auto Maintenance"]),
    ("expense", "Healthcare", ["Insurance", "Medical"]),
    ("expense", "Personal", ["Clothing", "Subscriptions", "Entertainment"]),
    ("expense", "Other", []),
]


def _create_default_categories(budget: Budget, user) -> None:
    for cat_type, parent_name, child_names in DEFAULT_CATEGORIES:
        parent = Category.objects.create(
            budget=budget, name=parent_name, category_type=cat_type, created_by=user,
        )
        for child_name in child_names:
            Category.objects.create(
                budget=budget, name=child_name, category_type=cat_type, parent=parent, created_by=user,
            )


class BudgetCreateView(LoginRequiredMixin, View):
    def post(self, request):
        data = parse_json_body(request)
        name = data.get("name", "").strip()
        copy_from_id = data.get("copy_from")

        budget = Budget.objects.create(created_by=request.user, name=name)
        BudgetMembership.objects.create(budget=budget, user=request.user, role=BudgetMembership.ROLE_OWNER)

        if copy_from_id:
            source = Budget.objects.filter(pk=copy_from_id, members=request.user).first()
            if source:
                if data.get("copy_categories", True):
                    Category.objects.bulk_create([
                        Category(
                            budget=budget,
                            name=cat.name,
                            category_type=cat.category_type,
                            created_by=request.user,
                        )
                        for cat in source.categories.all()
                    ])
                if data.get("copy_payment_methods", True):
                    PaymentMethod.objects.bulk_create([
                        PaymentMethod(
                            budget=budget,
                            name=pm.name,
                            payment_type=pm.payment_type,
                            last_four=pm.last_four,
                            is_active=pm.is_active,
                        )
                        for pm in source.payment_methods.all()
                    ])
                if data.get("copy_members", True):
                    BudgetMembership.objects.bulk_create([
                        BudgetMembership(budget=budget, user=m.user, role=BudgetMembership.ROLE_MEMBER)
                        for m in source.memberships.select_related("user").all()
                        if m.user != request.user
                    ])
        elif data.get("add_default_categories", False):
            _create_default_categories(budget, request.user)

        return JsonResponse({"id": budget.pk}, status=201)

    def get(self, request):
        return redirect(reverse("budget:list"))


class BudgetDetailView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        month_str = request.GET.get("month") or _default_month()
        budget = self.budget
        user_rate = _get_user_currency_rate(request.user)
        return inertia_render(request, "Dashboard", {
            "budget_pk": budget.pk,
            "month": month_str,
            "overview": lambda: get_budget_overview(budget, month_str, user_rate),
            "categories": lambda: [
                serialize_category(c)
                for c in Category.objects.filter(budget=budget, is_system=False).order_by("category_type", "name")
            ],
            "payment_methods": lambda: [
                serialize_payment_method(pm)
                for pm in PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            ],
            "pending_count": lambda: get_pending_count(budget, month_str),
            "currencies": _serialize_currencies,
            "user_currency": request.user.currency or "USD",
        })


class GoalsView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        month_str = request.GET.get("month") or _default_month()
        budget = self.budget
        user_rate = _get_user_currency_rate(request.user)
        return inertia_render(request, "Goals", {
            "budget_pk": budget.pk,
            "month": month_str,
            "overview": lambda: get_budget_overview(budget, month_str, user_rate),
            "categories": lambda: [
                serialize_category(c)
                for c in Category.objects.filter(budget=budget, is_system=False).order_by("category_type", "name")
            ],
            "payment_methods": lambda: [
                serialize_payment_method(pm)
                for pm in PaymentMethod.objects.filter(budget=budget, is_active=True)
            ],
            "currencies": _serialize_currencies,
            "user_currency": request.user.currency or "USD",
        })


class BudgetUpdateView(BudgetOwnerMixin, View):
    def patch(self, request, budget_pk):
        data = parse_json_body(request)
        self.budget.name = data.get("name", "").strip()
        self.budget.save(update_fields=["name", "updated_at"])
        return JsonResponse({"id": self.budget.pk, "name": self.budget.name})


class BudgetDeleteView(BudgetOwnerMixin, View):
    def delete(self, request, budget_pk):
        self.budget.delete()
        return JsonResponse({}, status=204)


class BudgetSettingsView(BudgetMemberMixin, View):
    """Single per-budget settings page — Budget / Income / Expense / Payment Methods / Members."""

    def get(self, request, budget_pk):
        from django.db.models import Sum

        budget = self.budget
        is_owner = BudgetMembership.objects.filter(
            budget=budget, user=request.user, role=BudgetMembership.ROLE_OWNER
        ).exists()
        is_default = request.user.default_budget_id == budget.pk

        # Categories — include goal total_saved like CategoryListView did,
        # so the modal can present accurate balances when editing.
        categories = list(Category.objects.filter(budget=budget, is_system=False).order_by("category_type", "name"))
        goal_ids = [c.pk for c in categories if c.is_goal]
        income_saved = {
            row["category_id"]: row["total"]
            for row in TransactionLine.objects.filter(
                transaction__budget=budget,
                category_id__in=goal_ids,
                transaction__transaction_type__in=("income", "transfer"),
            ).values("category_id").annotate(total=Sum("amount"))
        }
        expense_saved = {
            row["category_id"]: row["total"]
            for row in TransactionLine.objects.filter(
                transaction__budget=budget,
                category_id__in=goal_ids,
                transaction__transaction_type="expense",
            ).values("category_id").annotate(total=Sum("amount"))
        }

        def _serialize_cat(c):
            d = serialize_category(c)
            if c.is_goal:
                d["total_saved"] = str(
                    income_saved.get(c.pk, Decimal("0.00")) - expense_saved.get(c.pk, Decimal("0.00"))
                )
            return d

        memberships = []
        if is_owner:
            memberships = [
                serialize_membership(m)
                for m in BudgetMembership.objects.filter(budget=budget).select_related("user")
            ]

        recurring_qs = RecurringTransaction.objects.filter(budget=budget).select_related("category", "payment_method")

        return inertia_render(request, "BudgetSettings", {
            "budget_pk": budget.pk,
            "budget": {
                "pk": budget.pk,
                "name": budget.name or "",
                "is_default": is_default,
                "is_owner": is_owner,
            },
            "categories": [_serialize_cat(c) for c in categories],
            "category_type_choices": [{"value": v, "label": l} for v, l in Category.TYPE_CHOICES],
            "payment_methods": [serialize_payment_method(pm) for pm in PaymentMethod.objects.filter(budget=budget)],
            "payment_method_type_choices": [{"value": v, "label": l} for v, l in PaymentMethod.TYPE_CHOICES],
            "memberships": memberships,
            "role_choices": [{"value": v, "label": l} for v, l in BudgetMembership.ROLE_CHOICES],
            "recurring": lambda: [serialize_recurring(rt) for rt in recurring_qs],
            "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
        })


# ---------------------------------------------------------------------------
# Category Budget (assigned amounts)
# ---------------------------------------------------------------------------


class CategoryBudgetUpdateView(BudgetMemberMixin, View):
    """Upsert the assigned amount for a category in a given month."""

    def post(self, request, budget_pk, category_pk):
        category = get_object_or_404(Category, pk=category_pk, budget=self.budget)
        data = parse_json_body(request)
        month_str = data.get("month", "")
        assigned = data.get("assigned", "0.00")
        try:
            month = datetime.date.fromisoformat(
                month_str + "-01" if len(month_str) == 7 else month_str
            ).replace(day=1)
        except (ValueError, TypeError):
            return JsonResponse({"errors": {"month": ["Invalid month."]}}, status=400)
        CategoryBudget.objects.update_or_create(
            budget=self.budget,
            category=category,
            month=month,
            defaults={"assigned": assigned},
        )
        return redirect(
            reverse("budget:detail", kwargs={"budget_pk": budget_pk}) + f"?month={month_str}"
        )

    patch = post


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


class MemberInviteView(BudgetOwnerMixin, View):
    def post(self, request, budget_pk):
        data = parse_json_body(request)
        email = data.get("email", "").strip()
        role = data.get("role", BudgetMembership.ROLE_MEMBER)
        if not email:
            return JsonResponse({"errors": {"email": ["Email is required."]}}, status=400)
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return JsonResponse({"errors": {"email": [f"No account found for {email}."]}}, status=400)
        _, created = BudgetMembership.objects.get_or_create(
            budget=self.budget, user=user, defaults={"role": role}
        )
        if not created:
            return JsonResponse({"errors": {"email": [f"{email} is already a member."]}}, status=400)
        membership = BudgetMembership.objects.select_related("user").get(budget=self.budget, user=user)
        return JsonResponse(serialize_membership(membership), status=201)


class MemberRemoveView(BudgetOwnerMixin, View):
    def delete(self, request, budget_pk, pk):
        membership = get_object_or_404(BudgetMembership, pk=pk, budget=self.budget)
        if membership.user == request.user:
            return JsonResponse({"errors": {"detail": "You cannot remove yourself."}}, status=400)
        owner_count = BudgetMembership.objects.filter(budget=self.budget, role=BudgetMembership.ROLE_OWNER).count()
        if membership.role == BudgetMembership.ROLE_OWNER and owner_count <= 1:
            return JsonResponse({"errors": {"detail": "Cannot remove the last owner."}}, status=400)
        membership.delete()
        return JsonResponse({}, status=204)


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class CategoryCreateView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = parse_json_body(request)
        name = data.get("name", "").strip()
        category_type = data.get("category_type", Category.TYPE_EXPENSE)
        is_goal = bool(data.get("is_goal", False))
        is_ongoing = bool(data.get("goal_ongoing", False))
        parent_id = data.get("parent_id") or None
        errors: dict[str, list[str]] = {}
        if not name:
            errors["name"] = ["Name is required."]
        if category_type not in (Category.TYPE_INCOME, Category.TYPE_EXPENSE):
            errors["category_type"] = ["Select a valid type."]
        parent = None
        if parent_id:
            try:
                parent = Category.objects.get(pk=parent_id, budget=self.budget)
            except Category.DoesNotExist:
                errors["parent_id"] = ["Parent category not found."]
            else:
                if parent.parent_id:
                    errors["parent_id"] = ["Cannot nest more than two levels deep."]
                else:
                    category_type = parent.category_type
        if is_goal:
            if not data.get("goal_target"):
                errors["goal_target"] = ["Target amount is required."]
            if not is_ongoing and not data.get("goal_due_date"):
                errors["goal_due_date"] = ["Due date is required for non-ongoing funds."]
            if is_ongoing and data.get("goal_monthly") is None:
                errors["goal_monthly"] = ["Monthly goal is required for ongoing funds."]
        if errors:
            return JsonResponse({"errors": errors}, status=400)
        try:
            cat = Category.objects.create(
                budget=self.budget,
                parent=parent,
                name=name,
                category_type=category_type,
                created_by=request.user,
            )
        except IntegrityError:
            return JsonResponse({"errors": {"name": ["A category with this name and type already exists."]}}, status=400)
        if is_goal:
            Goal.objects.create(
                category=cat,
                target=data.get("goal_target"),
                due_date=data.get("goal_due_date") if not is_ongoing else None,
                ongoing=is_ongoing,
                monthly_goal=data.get("goal_monthly") if is_ongoing else None,
            )

        # Create an opening balance transaction if an initial amount was provided
        if is_goal:
            initial = data.get("goal_initial_balance", "0") or "0"
            try:
                amount = Decimal(str(initial))
                if amount > 0:
                    today = datetime.date.today()
                    txn = Transaction.objects.create(
                        budget=self.budget,
                        description=f"{cat.name} — opening balance",
                        due_date=today,
                        paid_date=today,
                        transaction_type="income",
                        created_by=request.user,
                    )
                    TransactionLine.objects.create(transaction=txn, category=cat, amount=amount, amount_usd=amount, description="Opening balance")
            except (ValueError, InvalidOperation):
                pass

        total_saved = get_goal_total_saved(self.budget, cat.pk) if is_goal else None
        return JsonResponse(serialize_category(cat, total_saved=total_saved), status=201)


class CategoryUpdateView(BudgetMemberMixin, View):
    def patch(self, request, budget_pk, pk):
        category = get_object_or_404(Category, pk=pk, budget=self.budget)
        data = parse_json_body(request)
        for field in ("name", "category_type", "monthly_budget"):
            if field in data:
                setattr(category, field, data[field])

        # Goal fields land on the related Goal row.
        goal_fields = {"goal_target", "goal_due_date", "goal_ongoing", "goal_monthly"}
        if goal_fields & set(data.keys()):
            goal = getattr(category, "goal", None)
            target = data.get("goal_target", goal.target if goal else None)
            due_date = data.get("goal_due_date", goal.due_date if goal else None)
            ongoing = bool(data.get("goal_ongoing", goal.ongoing if goal else False))
            monthly_goal = data.get("goal_monthly", goal.monthly_goal if goal else None)
            if target:
                Goal.objects.update_or_create(
                    category=category,
                    defaults={
                        "target": target,
                        "due_date": due_date or None,
                        "ongoing": ongoing,
                        "monthly_goal": monthly_goal or None,
                    },
                )
            elif goal:
                goal.delete()
        if "parent_id" in data:
            new_parent_id = data["parent_id"] or None
            if new_parent_id is None:
                category.parent = None
            else:
                try:
                    new_parent = Category.objects.get(pk=new_parent_id, budget=self.budget)
                except Category.DoesNotExist:
                    return JsonResponse({"errors": {"parent_id": ["Parent not found."]}}, status=400)
                if new_parent.pk == category.pk or new_parent.parent_id:
                    return JsonResponse({"errors": {"parent_id": ["Invalid parent."]}}, status=400)
                if category.children.exists():
                    return JsonResponse({"errors": {"parent_id": ["Cannot make a parent into a child."]}}, status=400)
                category.parent = new_parent
                category.category_type = new_parent.category_type
        category.save()

        # Create an income transaction if an add_amount was provided
        add_amount_str = data.get("add_amount", "") or ""
        try:
            add_amount = Decimal(str(add_amount_str))
        except (ValueError, InvalidOperation):
            add_amount = Decimal("0")
        if add_amount > 0:
            desc = data.get("add_description", "").strip() or f"{category.name} — balance adjustment"
            today = datetime.date.today()
            txn = Transaction.objects.create(
                budget=self.budget,
                description=desc,
                due_date=today,
                paid_date=today,
                transaction_type="income",
                created_by=request.user,
            )
            TransactionLine.objects.create(transaction=txn, category=category, amount=add_amount, amount_usd=add_amount, description="")

        total_saved = get_goal_total_saved(self.budget, category.pk) if category.is_goal else None
        return JsonResponse(serialize_category(category, total_saved=total_saved))


class CategoryDeleteView(BudgetMemberMixin, View):
    def delete(self, request, budget_pk, pk):
        category = get_object_or_404(Category, pk=pk, budget=self.budget)
        try:
            category.delete()
        except ProtectedError:
            return JsonResponse(
                {"errors": {"detail": "This category has transactions and cannot be deleted."}},
                status=409,
            )
        return JsonResponse({}, status=204)


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


class TransactionListView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        month_str = request.GET.get("month") or _default_month()
        category_filter = request.GET.get("category")
        budget = self.budget

        def _bank_txns_with_status(status):
            try:
                month_start = datetime.date.fromisoformat(month_str + "-01")
                last_day = calendar.monthrange(month_start.year, month_start.month)[1]
                month_end = month_start.replace(day=last_day)
            except (ValueError, TypeError):
                month_start = datetime.date.today().replace(day=1)
                last_day = calendar.monthrange(month_start.year, month_start.month)[1]
                month_end = month_start.replace(day=last_day)
            qs = (
                BankTransaction.objects
                .filter(
                    bank_account__connection__user=request.user,
                    bank_account__payment_method__budget=budget,
                    status=status,
                    posted_at__date__range=(month_start, month_end),
                )
                .select_related("bank_account")
                .order_by("-posted_at")
            )
            return [serialize_bank_transaction(bt) for bt in qs]

        def _bank_txns():
            return _bank_txns_with_status(BankTransaction.Status.PENDING)

        def _ignored_bank_txns():
            return _bank_txns_with_status(BankTransaction.Status.IGNORED)

        def _transactions():
            try:
                month_start = datetime.date.fromisoformat(month_str + "-01")
                last_day = calendar.monthrange(month_start.year, month_start.month)[1]
                month_end = month_start.replace(day=last_day)
            except (ValueError, TypeError):
                month_start = datetime.date.today().replace(day=1)
                last_day = calendar.monthrange(month_start.year, month_start.month)[1]
                month_end = month_start.replace(day=last_day)

            qs = (
                Transaction.objects.filter(budget=budget)
                .annotate(effective_date=Coalesce("paid_date", "due_date"))
                .filter(effective_date__range=(month_start, month_end))
                .select_related("recurring__category", "payment_method")
                .prefetch_related("lines__category", "bank_transaction__bank_account")
            )
            if category_filter:
                try:
                    cat_pk = int(category_filter)
                    qs = qs.filter(
                        Q(lines__category_id=cat_pk) | Q(recurring__category_id=cat_pk)
                    ).distinct()
                except (ValueError, TypeError):
                    pass
            return [serialize_transaction(t) for t in qs.order_by("-effective_date")]

        return inertia_render(request, "Transactions", {
            "budget_pk": budget.pk,
            "month": month_str,
            "category_filter": category_filter or "",
            "transactions": _transactions,
            "bank_transactions": _bank_txns,
            "ignored_bank_transactions": _ignored_bank_txns,
            "categories": lambda: [
                serialize_category(c)
                for c in Category.objects.filter(budget=budget, is_system=False).order_by("category_type", "name")
            ],
            "payment_methods": lambda: [
                serialize_payment_method(pm)
                for pm in PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            ],
            "currencies": _serialize_currencies,
            "user_currency": request.user.currency or "USD",
        })


class TransactionCreateView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = parse_json_body(request)
        description = data.get("description", "").strip()
        due_date_str = data.get("due_date", "")
        paid_date_str = data.get("paid_date", "")
        notes = data.get("notes", "")
        payment_method_id = data.get("payment_method")
        lines_data = data.get("lines", [])
        currency = data.get("currency") or request.user.currency or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")

        errors: dict[str, list[str]] = {}
        if not description:
            errors["description"] = ["Description is required."]
        try:
            due_date = datetime.date.fromisoformat(due_date_str)
        except (ValueError, TypeError):
            errors["due_date"] = ["Enter a valid date."]
            due_date = datetime.date.today()
        paid_date = None
        if paid_date_str:
            try:
                paid_date = datetime.date.fromisoformat(paid_date_str)
            except (ValueError, TypeError):
                errors["paid_date"] = ["Enter a valid date."]
        explicit_txn_type = data.get("transaction_type", "")
        if not lines_data:
            errors["lines"] = ["At least one line item is required."]
        else:
            line_cat_ids = [l.get("category") for l in lines_data if l.get("category")]
            cat_info = list(
                Category.objects.filter(pk__in=line_cat_ids)
                .values_list("category_type", "goal")
            )
            non_goal_types = {ct for ct, g in cat_info if g is None}
            if len(non_goal_types) > 1:
                errors["lines"] = ["All lines must be the same type (income or expense)."]
        if errors:
            return JsonResponse({"errors": errors}, status=400)

        payment_method = None
        if payment_method_id:
            payment_method = PaymentMethod.objects.filter(pk=payment_method_id, budget=self.budget).first()

        with db_transaction.atomic():
            txn = Transaction.objects.create(
                budget=self.budget,
                created_by=request.user,
                description=description,
                due_date=due_date,
                paid_date=paid_date,
                notes=notes,
                transaction_type=explicit_txn_type,
                payment_method=payment_method,
                currency=currency,
                exchange_rate_to_usd=exchange_rate,
            )
            for line in lines_data:
                cat = get_object_or_404(Category, pk=line["category"], budget=self.budget)
                amount = Decimal(str(line.get("amount", "0.00")))
                TransactionLine.objects.create(
                    transaction=txn,
                    category=cat,
                    amount=amount,
                    amount_usd=amount / exchange_rate if exchange_rate else amount,
                    description=line.get("description", ""),
                )

        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category", "bank_transaction__bank_account").get(pk=txn.pk)
        return JsonResponse(serialize_transaction(txn), status=201)


class TransactionDetailView(BudgetMemberMixin, View):
    def get(self, request, budget_pk, pk):
        txn = get_object_or_404(
            Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category", "bank_transaction__bank_account"),
            pk=pk,
            budget=self.budget,
        )
        return inertia_render(request, "TransactionDetail", {
            "budget_pk": self.budget.pk,
            "transaction": serialize_transaction(txn),
        })


class TransactionUpdateView(BudgetMemberMixin, View):
    def patch(self, request, budget_pk, pk):
        txn = get_object_or_404(Transaction, pk=pk, budget=self.budget)
        data = parse_json_body(request)

        if "description" in data:
            txn.description = data["description"]
        if "due_date" in data:
            txn.due_date = datetime.date.fromisoformat(data["due_date"])
        if "paid_date" in data:
            txn.paid_date = datetime.date.fromisoformat(data["paid_date"]) if data["paid_date"] else None
        if "notes" in data:
            txn.notes = data["notes"]
        if "payment_method" in data:
            pm_id = data["payment_method"]
            txn.payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        if "transaction_type" in data:
            txn.transaction_type = data["transaction_type"]
        if "currency" in data:
            currency = data["currency"]
            try:
                txn.exchange_rate_to_usd = CurrencyModel.objects.get(code=currency).rate_to_usd
            except CurrencyModel.DoesNotExist:
                txn.exchange_rate_to_usd = Decimal("1")
            txn.currency = currency

        lines_data = data.get("lines")
        with db_transaction.atomic():
            txn.save()
            if lines_data is not None:
                txn.lines.all().delete()
                exchange_rate = txn.exchange_rate_to_usd or Decimal("1")
                for line in lines_data:
                    cat = get_object_or_404(Category, pk=line["category"], budget=self.budget)
                    amount = Decimal(str(line.get("amount", "0.00")))
                    TransactionLine.objects.create(
                        transaction=txn,
                        category=cat,
                        amount=amount,
                        amount_usd=amount / exchange_rate,
                        description=line.get("description", ""),
                    )

        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category", "bank_transaction__bank_account").get(pk=txn.pk)
        return JsonResponse(serialize_transaction(txn))


class TransactionDeleteView(BudgetMemberMixin, View):
    def delete(self, request, budget_pk, pk):
        get_object_or_404(Transaction, pk=pk, budget=self.budget).delete()
        return JsonResponse({}, status=204)

    def post(self, request, budget_pk, pk):
        """Support POST for delete (form-based deletion from detail page)."""
        get_object_or_404(Transaction, pk=pk, budget=self.budget).delete()
        return redirect(reverse("budget:transaction-list", kwargs={"budget_pk": budget_pk}))


class TransactionMarkPaidView(BudgetMemberMixin, View):
    def post(self, request, budget_pk, pk):
        transaction = get_object_or_404(Transaction, pk=pk, budget=self.budget)
        clearing = transaction.paid_date is not None
        transaction.paid_date = None if clearing else datetime.date.today()
        transaction.save(update_fields=["paid_date"])
        # Clearing paid_date on a bank-linked txn would leave the link inconsistent.
        # Drop the bank link back to pending so the bank row can be re-reconciled.
        if clearing:
            bt = getattr(transaction, "bank_transaction", None)
            if bt is not None:
                bt.status = BankTransaction.Status.PENDING
                bt.transaction = None
                bt.ignore_reason = ""
                bt.save(update_fields=["status", "transaction", "ignore_reason", "last_seen_at"])
        # Support both Inertia (redirect) and JSON (fetch) callers
        if request.headers.get("X-Inertia"):
            next_url = request.POST.get("next") or reverse(
                "budget:detail", kwargs={"budget_pk": budget_pk}
            )
            return redirect(next_url)
        return JsonResponse(serialize_transaction(
            Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category", "bank_transaction__bank_account").get(pk=pk)
        ))


class TransferCandidatesView(BudgetMemberMixin, View):
    """List likely transfer-partner Transactions for the given transaction."""

    def get(self, request, budget_pk, pk):
        txn = get_object_or_404(
            Transaction.objects.select_related("payment_method").prefetch_related("lines__category"),
            pk=pk,
            budget=self.budget,
        )
        candidates = find_transfer_candidates(txn)
        return JsonResponse({
            "candidates": [serialize_transaction(c) for c in candidates],
        })


class TransferLinkView(BudgetMemberMixin, View):
    """Link or unlink a transaction's transfer partner.

    PATCH body: `{"partner_id": <int>}` to link, `{"partner_id": null}` to unlink.
    """

    def patch(self, request, budget_pk, pk):
        txn = get_object_or_404(Transaction, pk=pk, budget=self.budget)
        data = parse_json_body(request)
        partner_id = data.get("partner_id")
        if partner_id is None:
            txn.unlink_transfer()
        else:
            partner = get_object_or_404(Transaction, pk=partner_id, budget=self.budget)
            try:
                txn.link_transfer(partner)
            except ValueError as exc:
                return JsonResponse({"error": str(exc)}, status=400)
        txn.refresh_from_db()
        return JsonResponse(serialize_transaction(
            Transaction.objects
            .select_related("recurring__category", "payment_method")
            .prefetch_related("lines__category", "bank_transaction__bank_account")
            .get(pk=txn.pk)
        ))


# ---------------------------------------------------------------------------
# Recurring Transactions
# ---------------------------------------------------------------------------


class RecurringCreateView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = parse_json_body(request)
        errors = self._validate(data)
        if errors:
            return JsonResponse({"errors": errors}, status=422)
        rt = self._create(request, data)
        return JsonResponse(serialize_recurring(rt), status=201)

    def _validate(self, data) -> dict:
        errors: dict[str, list[str]] = {}
        if not data.get("name", "").strip():
            errors["name"] = ["Name is required."]
        if not data.get("category"):
            errors["category"] = ["Category is required."]
        try:
            float(data.get("amount", ""))
        except (ValueError, TypeError):
            errors["amount"] = ["Enter a valid amount."]
        if not data.get("start_date"):
            errors["start_date"] = ["Start date is required."]
        if data.get("frequency") == RecurringTransaction.FREQ_EVERY_N:
            try:
                if int(data.get("interval", 0)) < 1:
                    raise ValueError
            except (ValueError, TypeError):
                errors["interval"] = ["Interval must be at least 1 month."]
        return errors

    def _create(self, request, data):
        pm_id = data.get("payment_method")
        payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        category = get_object_or_404(Category, pk=data["category"], budget=self.budget)
        end_date = None
        if data.get("end_date"):
            try:
                end_date = datetime.date.fromisoformat(data["end_date"])
            except (ValueError, TypeError):
                pass
        rt = RecurringTransaction.objects.create(
            budget=self.budget,
            created_by=request.user,
            category=category,
            payment_method=payment_method,
            name=data["name"].strip(),
            description=data.get("description", ""),
            amount=data["amount"],
            frequency=data["frequency"],
            interval=int(data.get("interval", 1)),
            start_date=datetime.date.fromisoformat(data["start_date"]),
            end_date=end_date,
            is_active=data.get("is_active", True),
        )
        lookahead = getattr(django_settings, "BUDGET_RECURRING_LOOKAHEAD_MONTHS", 3)
        today = datetime.date.today()
        year = today.year + (today.month + lookahead - 1) // 12
        month = (today.month + lookahead - 1) % 12 + 1
        through_date = today.replace(year=year, month=month, day=calendar.monthrange(year, month)[1])
        rt.generate_instances_up_to(through_date)
        return rt


class RecurringDetailView(BudgetMemberMixin, View):
    def patch(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        data = parse_json_body(request)
        updatable = ("name", "description", "amount", "frequency", "interval",
                     "start_date", "end_date", "is_active")
        for field in updatable:
            if field in data:
                val = data[field]
                if field in ("start_date",) and val:
                    val = datetime.date.fromisoformat(val)
                if field == "end_date":
                    val = datetime.date.fromisoformat(val) if val else None
                setattr(rt, field, val)
        if "category" in data:
            rt.category = get_object_or_404(Category, pk=data["category"], budget=self.budget)
        if "payment_method" in data:
            pm_id = data["payment_method"]
            rt.payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        rt.save()

        # Rebuild unpaid future instances so edits to amount/category/schedule/end_date
        # propagate. Paid instances are historical and stay untouched.
        today = datetime.date.today()
        Transaction.objects.filter(recurring=rt, paid_date__isnull=True, due_date__gt=today).delete()
        rt.generated_through = None
        rt.save(update_fields=["generated_through"])
        lookahead = getattr(django_settings, "BUDGET_RECURRING_LOOKAHEAD_MONTHS", 3)
        year = today.year + (today.month + lookahead - 1) // 12
        month = (today.month + lookahead - 1) % 12 + 1
        through_date = today.replace(year=year, month=month, day=calendar.monthrange(year, month)[1])
        rt.generate_instances_up_to(through_date)

        return JsonResponse(serialize_recurring(rt))

    def post(self, request, budget_pk, pk):
        """Manually create a transaction instance for this recurring schedule."""
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        data = parse_json_body(request)
        due_date_str = data.get("due_date", "")
        if not due_date_str:
            return JsonResponse({"errors": {"due_date": ["This field is required."]}}, status=400)
        try:
            due_date = datetime.date.fromisoformat(due_date_str)
        except ValueError:
            return JsonResponse({"errors": {"due_date": ["Enter a valid date."]}}, status=400)
        currency_code = getattr(rt.created_by, "currency", None) or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency_code).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")
        txn = Transaction.objects.create(
            budget=self.budget,
            recurring=rt,
            description=data.get("description") or rt.name,
            due_date=due_date,
            created_by=request.user,
            payment_method=rt.payment_method,
            currency=currency_code,
            exchange_rate_to_usd=exchange_rate,
        )
        TransactionLine.objects.create(
            transaction=txn,
            category=rt.category,
            amount=rt.amount,
            amount_usd=rt.amount / exchange_rate if exchange_rate else rt.amount,
        )
        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category", "bank_transaction__bank_account").get(pk=txn.pk)
        return JsonResponse(serialize_transaction(txn), status=201)

    def delete(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        if request.GET.get("permanent"):
            rt.delete()
            return JsonResponse({}, status=204)
        today = datetime.date.today()
        if request.GET.get("delete_future_unpaid"):
            Transaction.objects.filter(recurring=rt, paid_date__isnull=True, due_date__gt=today).delete()
        rt.is_active = False
        rt.end_date = today
        rt.save(update_fields=["is_active", "end_date"])
        return JsonResponse({}, status=204)


# ---------------------------------------------------------------------------
# Bank transactions (SimpleFIN → local Transaction reconciliation)
# ---------------------------------------------------------------------------


def _bank_txn_for_budget(request, budget, pk) -> BankTransaction:
    """Fetch a BankTransaction that belongs to (a) the requesting user and (b) the given budget
    via its bank account's payment_method mapping."""
    qs = (
        BankTransaction.objects
        .select_related("bank_account__payment_method", "bank_account__connection")
        .filter(bank_account__connection__user=request.user)
    )
    bt = get_object_or_404(qs, pk=pk)
    pm = bt.bank_account.payment_method
    if pm is None or pm.budget_id != budget.pk:
        raise Http404
    return bt


class BankTransactionListView(BudgetMemberMixin, View):
    """List pending BankTransactions whose bank account is mapped to a PaymentMethod in this budget."""

    def get(self, request, budget_pk):
        qs = (
            BankTransaction.objects
            .filter(
                bank_account__connection__user=request.user,
                bank_account__payment_method__budget=self.budget,
                status=BankTransaction.Status.PENDING,
            )
            .select_related("bank_account")
            .order_by("-posted_at")
        )
        return JsonResponse({
            "bank_transactions": [serialize_bank_transaction(bt) for bt in qs],
        })


class BankTransactionSuggestionsView(BudgetMemberMixin, View):
    def get(self, request, budget_pk, pk):
        from apps.budget.bank_matching import suggest_matches

        bt = _bank_txn_for_budget(request, self.budget, pk)
        transfer_candidates = find_transfer_candidates_for_bank_txn(bt, self.budget)
        pending_bank_pairs = find_pending_bank_transfer_candidates(bt, self.budget)
        return JsonResponse({
            "bank_transaction": serialize_bank_transaction(bt),
            "suggestions": suggest_matches(bt, self.budget),
            "transfer_candidates": [serialize_transaction(t) for t in transfer_candidates],
            "transfer_candidates_bank": [serialize_bank_transaction(b) for b in pending_bank_pairs],
        })


class BankTransactionLinkView(BudgetMemberMixin, View):
    """Link a BankTransaction to an existing Transaction in this budget."""

    def post(self, request, budget_pk, pk):
        bt = _bank_txn_for_budget(request, self.budget, pk)
        data = parse_json_body(request)
        txn_id = data.get("transaction_id")
        if not txn_id:
            return JsonResponse({"errors": {"transaction_id": ["Required."]}}, status=400)
        txn = get_object_or_404(Transaction, pk=txn_id, budget=self.budget)
        with db_transaction.atomic():
            bt.transaction = txn
            bt.status = BankTransaction.Status.LINKED
            bt.save(update_fields=["transaction", "status", "last_seen_at"])
            update_fields = ["payment_method", "updated_at"]
            if txn.paid_date is None:
                txn.paid_date = bt.posted_at.date()
                update_fields.append("paid_date")
            if not txn.payment_method_id and bt.bank_account.payment_method_id:
                txn.payment_method_id = bt.bank_account.payment_method_id
            txn.save(update_fields=update_fields)
        txn = (
            Transaction.objects
            .select_related("recurring__category", "payment_method")
            .prefetch_related("lines__category", "bank_transaction__bank_account")
            .get(pk=txn.pk)
        )
        return JsonResponse({
            "bank_transaction": serialize_bank_transaction(bt),
            "transaction": serialize_transaction(txn),
        })


class BankTransactionCreateTxnView(BudgetMemberMixin, View):
    """Create a new Transaction from a BankTransaction and link them.

    Accepts either:
    - `lines: [{category_id, amount, description?}]` — explicit splits; must sum to abs(bt.amount)
    - `category_id` (legacy) — single-line shortcut using the bank transaction's full amount
    """

    def post(self, request, budget_pk, pk):

        bt = _bank_txn_for_budget(request, self.budget, pk)
        data = parse_json_body(request)
        description = (data.get("description") or bt.payee or bt.description).strip()

        bt_amount = abs(bt.amount)
        lines_data = data.get("lines")
        if not lines_data:
            category_id = data.get("category_id")
            if not category_id:
                return JsonResponse({"errors": {"category_id": ["Required."]}}, status=400)
            lines_data = [{"category_id": category_id, "amount": str(bt_amount), "description": ""}]

        # Validate lines
        errors: dict[str, list[str]] = {}
        parsed_lines = []
        total = Decimal("0")
        categories_in_lines: list[Category] = []
        for i, ln in enumerate(lines_data):
            cat_id = ln.get("category_id") or ln.get("category")
            if not cat_id:
                errors[f"lines[{i}].category"] = ["Required."]
                continue
            try:
                cat = Category.objects.get(pk=cat_id, budget=self.budget)
            except Category.DoesNotExist:
                errors[f"lines[{i}].category"] = ["Not found."]
                continue
            try:
                amt = Decimal(str(ln.get("amount", "0")))
            except (InvalidOperation, ValueError):
                errors[f"lines[{i}].amount"] = ["Enter a valid number."]
                continue
            if amt <= 0:
                errors[f"lines[{i}].amount"] = ["Must be greater than 0."]
                continue
            total += amt
            categories_in_lines.append(cat)
            parsed_lines.append({"category": cat, "amount": amt, "description": (ln.get("description") or "")[:200]})

        if not parsed_lines and not errors:
            errors["lines"] = ["At least one line is required."]
        if total and abs(total - bt_amount) > Decimal("0.01"):
            errors["lines"] = [f"Line amounts must sum to {bt_amount}, got {total}."]

        if errors:
            return JsonResponse({"errors": errors}, status=400)

        pm_id = data.get("payment_method_id") or bt.bank_account.payment_method_id
        payment_method = (
            PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        )

        # Derive transaction_type from the lines' categories if the client didn't send one.
        non_goal_types = {c.category_type for c in categories_in_lines if not c.is_goal}
        base_type = non_goal_types.pop() if len(non_goal_types) == 1 else (categories_in_lines[0].category_type if categories_in_lines else "expense")
        txn_type = data.get("transaction_type") or base_type

        currency = bt.bank_account.currency or request.user.currency or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")

        with db_transaction.atomic():
            txn = Transaction.objects.create(
                budget=self.budget,
                created_by=request.user,
                description=description[:200],
                due_date=bt.posted_at.date(),
                paid_date=bt.posted_at.date(),
                transaction_type=txn_type,
                payment_method=payment_method,
                currency=currency,
                exchange_rate_to_usd=exchange_rate,
            )
            for ln in parsed_lines:
                TransactionLine.objects.create(
                    transaction=txn,
                    category=ln["category"],
                    amount=ln["amount"],
                    amount_usd=ln["amount"] / exchange_rate if exchange_rate else ln["amount"],
                    description=ln["description"],
                )
            bt.transaction = txn
            bt.status = BankTransaction.Status.LINKED
            bt.save(update_fields=["transaction", "status", "last_seen_at"])

        txn = (
            Transaction.objects
            .select_related("recurring__category", "payment_method")
            .prefetch_related("lines__category", "bank_transaction__bank_account")
            .get(pk=txn.pk)
        )
        transfer_candidates = [serialize_transaction(c) for c in find_transfer_candidates(txn)]
        return JsonResponse({
            "bank_transaction": serialize_bank_transaction(bt),
            "transaction": serialize_transaction(txn),
            "transfer_candidates": transfer_candidates,
        }, status=201)


class BankTransactionConfirmAsTransferView(BudgetMemberMixin, View):
    """Confirm a BankTransaction as one leg of a transfer.

    Body accepts either:
      - `partner_id` — an existing budget Transaction. Creates one new
        Transaction for this bank row, links it to the existing partner.
      - `partner_bank_txn_id` — another still-pending BankTransaction (the
        opposite leg). Creates two Transactions (one per bank row), links
        them, marks both bank rows linked. Used when both halves were just
        synced and neither has been confirmed yet.

    All resulting Transactions get `type="transfer"` with a line in the
    budget's system Transfers category.
    """

    def _make_transfer_txn(self, request, bt):
        """Build a transfer Transaction + line for a given bank row."""
        transfers_cat = Category.get_or_create_transfers(self.budget)
        amount = abs(bt.amount)
        pm_id = bt.bank_account.payment_method_id
        payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        currency = bt.bank_account.currency or request.user.currency or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")
        description = (bt.payee or bt.description or "Transfer").strip()[:200]
        txn = Transaction.objects.create(
            budget=self.budget,
            created_by=request.user,
            description=description,
            due_date=bt.posted_at.date(),
            paid_date=bt.posted_at.date(),
            transaction_type="transfer",
            payment_method=payment_method,
            currency=currency,
            exchange_rate_to_usd=exchange_rate,
        )
        TransactionLine.objects.create(
            transaction=txn,
            category=transfers_cat,
            amount=amount,
            amount_usd=amount / exchange_rate if exchange_rate else amount,
            description="",
        )
        bt.transaction = txn
        bt.status = BankTransaction.Status.LINKED
        bt.save(update_fields=["transaction", "status", "last_seen_at"])
        return txn

    def post(self, request, budget_pk, pk):
        bt = _bank_txn_for_budget(request, self.budget, pk)
        data = parse_json_body(request)
        partner_id = data.get("partner_id")
        partner_bank_txn_id = data.get("partner_bank_txn_id")
        if not partner_id and not partner_bank_txn_id:
            return JsonResponse({"errors": {"partner_id": ["partner_id or partner_bank_txn_id required."]}}, status=400)

        if partner_bank_txn_id:
            try:
                partner_bt = _bank_txn_for_budget(request, self.budget, partner_bank_txn_id)
            except Http404:
                return JsonResponse({"errors": {"partner_bank_txn_id": ["Not found."]}}, status=404)
            if partner_bt.status != BankTransaction.Status.PENDING:
                return JsonResponse({"errors": {"partner_bank_txn_id": ["No longer pending."]}}, status=400)
            with db_transaction.atomic():
                txn = self._make_transfer_txn(request, bt)
                partner_txn = self._make_transfer_txn(request, partner_bt)
                txn.link_transfer(partner_txn)
            return JsonResponse({
                "bank_transaction": serialize_bank_transaction(bt),
                "transaction": serialize_transaction(
                    Transaction.objects
                    .select_related("recurring__category", "payment_method")
                    .prefetch_related("lines__category", "bank_transaction__bank_account")
                    .get(pk=txn.pk)
                ),
                "partner_bank_transaction": serialize_bank_transaction(partner_bt),
                "partner": serialize_transaction(
                    Transaction.objects
                    .select_related("recurring__category", "payment_method")
                    .prefetch_related("lines__category", "bank_transaction__bank_account")
                    .get(pk=partner_txn.pk)
                ),
            }, status=201)

        try:
            partner = Transaction.objects.get(pk=partner_id, budget=self.budget)
        except Transaction.DoesNotExist:
            return JsonResponse({"errors": {"partner_id": ["Not found."]}}, status=404)
        if partner.transfer_partner_id:
            return JsonResponse({"errors": {"partner_id": ["Already linked to another transfer."]}}, status=400)

        with db_transaction.atomic():
            txn = self._make_transfer_txn(request, bt)
            txn.link_transfer(partner)

        return JsonResponse({
            "bank_transaction": serialize_bank_transaction(bt),
            "transaction": serialize_transaction(
                Transaction.objects
                .select_related("recurring__category", "payment_method")
                .prefetch_related("lines__category", "bank_transaction__bank_account")
                .get(pk=txn.pk)
            ),
            "partner": serialize_transaction(
                Transaction.objects
                .select_related("recurring__category", "payment_method")
                .prefetch_related("lines__category", "bank_transaction__bank_account")
                .get(pk=partner.pk)
            ),
        }, status=201)


class BankTransactionIgnoreView(BudgetMemberMixin, View):
    def post(self, request, budget_pk, pk):
        bt = _bank_txn_for_budget(request, self.budget, pk)
        data = parse_json_body(request)
        bt.status = BankTransaction.Status.IGNORED
        bt.transaction = None
        bt.ignore_reason = (data.get("reason") or "").strip()[:500]
        bt.save(update_fields=["status", "transaction", "ignore_reason", "last_seen_at"])
        return JsonResponse({"bank_transaction": serialize_bank_transaction(bt)})


class BankTransactionUnlinkView(BudgetMemberMixin, View):
    """Unlink a BankTransaction from its Transaction (does not delete the Transaction)."""

    def post(self, request, budget_pk, pk):
        bt = _bank_txn_for_budget(request, self.budget, pk)
        bt.status = BankTransaction.Status.PENDING
        bt.transaction = None
        bt.ignore_reason = ""
        bt.save(update_fields=["status", "transaction", "ignore_reason", "last_seen_at"])
        return JsonResponse({"bank_transaction": serialize_bank_transaction(bt)})
