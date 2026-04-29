import calendar
import datetime
import json

from django.conf import settings as django_settings
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction as db_transaction
from django.db.models import ProtectedError, Q
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse, reverse_lazy
from django.views import View
from django.views import generic

from inertia import render as inertia_render

from apps.budget.data import (
    get_budget_overview,
    get_upcoming_transactions,
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
    Transaction,
    TransactionLine,
)
from apps.accounts.models import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_month() -> str:
    today = datetime.date.today()
    return f"{today.year}-{today.month:02d}"


def _parse_json_body(request) -> dict:
    try:
        return json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return {}


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
    def get(self, request, budget_pk):
        methods = PaymentMethod.objects.filter(budget=self.budget)
        return inertia_render(request, "PaymentMethods", {
            "budget_pk": self.budget.pk,
            "payment_methods": [serialize_payment_method(pm) for pm in methods],
            "type_choices": [{"value": v, "label": l} for v, l in PaymentMethod.TYPE_CHOICES],
        })

    def post(self, request, budget_pk):
        data = _parse_json_body(request)
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
        data = _parse_json_body(request)
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

        budgets = Budget.objects.filter(members=request.user).order_by("-created_at")
        result = []
        for budget in budgets:
            month_qs = list(
                Transaction.objects.filter(budget=budget)
                .annotate(month=TruncMonth("due_date"))
                .values("month")
                .distinct()
                .order_by("-month")
            )
            result.append({
                "id": budget.pk,
                "name": budget.name or f"Budget #{budget.pk}",
                "months": [m["month"].strftime("%Y-%m") for m in month_qs],
            })
        return inertia_render(request, "BudgetHistory", {"budgets": result})


class BudgetHomeView(LoginRequiredMixin, View):
    """Redirect to the user's budget, creating one if needed."""

    def get(self, request):
        budget = Budget.objects.filter(members=request.user).first()
        if not budget:
            budget = Budget.objects.create(created_by=request.user)
            BudgetMembership.objects.create(budget=budget, user=request.user, role=BudgetMembership.ROLE_OWNER)
        return redirect(reverse("budget:detail", kwargs={"budget_pk": budget.pk}))


class BudgetListView(LoginRequiredMixin, View):
    def get(self, request):
        budgets = list(Budget.objects.filter(members=request.user))
        membership_map = {
            m.budget_id: m.role
            for m in BudgetMembership.objects.filter(budget__in=budgets, user=request.user)
        }
        return inertia_render(request, "BudgetList", {
            "budgets": [
                {
                    "id": b.pk,
                    "name": b.name,
                    "created_at": b.created_at.isoformat(),
                    "is_owner": membership_map.get(b.pk) == BudgetMembership.ROLE_OWNER,
                }
                for b in budgets
            ],
        })


class BudgetCreateView(LoginRequiredMixin, View):
    def post(self, request):
        data = _parse_json_body(request)
        name = data.get("name", "").strip()
        budget = Budget.objects.create(created_by=request.user, name=name)
        BudgetMembership.objects.create(budget=budget, user=request.user, role=BudgetMembership.ROLE_OWNER)
        return JsonResponse({"id": budget.pk}, status=201)

    def get(self, request):
        return redirect(reverse("budget:list"))


class BudgetDetailView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        month_str = request.GET.get("month") or _default_month()
        budget = self.budget
        return inertia_render(request, "Dashboard", {
            "budget_pk": budget.pk,
            "month": month_str,
            "overview": lambda: get_budget_overview(budget, month_str),
            "categories": lambda: [
                serialize_category(c)
                for c in Category.objects.filter(budget=budget).order_by("category_type", "name")
            ],
            "payment_methods": lambda: [
                serialize_payment_method(pm)
                for pm in PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            ],
            "upcoming_transactions": lambda: get_upcoming_transactions(budget),
        })


class BudgetUpdateView(BudgetOwnerMixin, View):
    def patch(self, request, budget_pk):
        data = _parse_json_body(request)
        self.budget.name = data.get("name", "").strip()
        self.budget.save(update_fields=["name", "updated_at"])
        return JsonResponse({"id": self.budget.pk, "name": self.budget.name})


class BudgetDeleteView(BudgetOwnerMixin, View):
    def delete(self, request, budget_pk):
        self.budget.delete()
        return JsonResponse({}, status=204)


# ---------------------------------------------------------------------------
# Category Budget (assigned amounts)
# ---------------------------------------------------------------------------


class CategoryBudgetUpdateView(BudgetMemberMixin, View):
    """Upsert the assigned amount for a category in a given month."""

    def post(self, request, budget_pk, category_pk):
        category = get_object_or_404(Category, pk=category_pk, budget=self.budget)
        data = _parse_json_body(request)
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


class MemberListView(BudgetOwnerMixin, View):
    def get(self, request, budget_pk):
        memberships = BudgetMembership.objects.filter(budget=self.budget).select_related("user")
        return inertia_render(request, "Members", {
            "budget_pk": self.budget.pk,
            "memberships": [serialize_membership(m) for m in memberships],
            "role_choices": [{"value": v, "label": l} for v, l in BudgetMembership.ROLE_CHOICES],
        })


class MemberInviteView(BudgetOwnerMixin, View):
    def post(self, request, budget_pk):
        data = _parse_json_body(request)
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


class CategoryListView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
        return inertia_render(request, "Categories", {
            "budget_pk": self.budget.pk,
            "categories": [serialize_category(c) for c in categories],
            "type_choices": [{"value": v, "label": l} for v, l in Category.TYPE_CHOICES],
        })


class CategoryCreateView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = _parse_json_body(request)
        name = data.get("name", "").strip()
        category_type = data.get("category_type", "")
        errors: dict[str, list[str]] = {}
        if not name:
            errors["name"] = ["Name is required."]
        if category_type not in (Category.TYPE_INCOME, Category.TYPE_EXPENSE):
            errors["category_type"] = ["Select a valid type."]
        if errors:
            return JsonResponse({"errors": errors}, status=400)
        try:
            cat = Category.objects.create(
                budget=self.budget,
                name=name,
                category_type=category_type,
                created_by=request.user,
            )
        except Exception:
            return JsonResponse({"errors": {"name": ["A category with this name and type already exists."]}}, status=400)
        return JsonResponse(serialize_category(cat), status=201)


class CategoryUpdateView(BudgetMemberMixin, View):
    def patch(self, request, budget_pk, pk):
        category = get_object_or_404(Category, pk=pk, budget=self.budget)
        data = _parse_json_body(request)
        for field in ("name", "category_type", "monthly_budget"):
            if field in data:
                setattr(category, field, data[field])
        category.save()
        return JsonResponse(serialize_category(category))


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
                Transaction.objects.filter(budget=budget, due_date__range=(month_start, month_end))
                .select_related("recurring__category", "payment_method")
                .prefetch_related("lines__category")
            )
            if category_filter:
                try:
                    cat_pk = int(category_filter)
                    qs = qs.filter(
                        Q(lines__category_id=cat_pk) | Q(recurring__category_id=cat_pk)
                    ).distinct()
                except (ValueError, TypeError):
                    pass
            return [serialize_transaction(t) for t in qs.order_by("due_date")]

        return inertia_render(request, "Transactions", {
            "budget_pk": budget.pk,
            "month": month_str,
            "category_filter": category_filter or "",
            "transactions": _transactions,
            "categories": lambda: [
                serialize_category(c)
                for c in Category.objects.filter(budget=budget).order_by("category_type", "name")
            ],
            "payment_methods": lambda: [
                serialize_payment_method(pm)
                for pm in PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            ],
        })


class TransactionCreateView(BudgetMemberMixin, View):
    def post(self, request, budget_pk):
        data = _parse_json_body(request)
        description = data.get("description", "").strip()
        due_date_str = data.get("due_date", "")
        paid_date_str = data.get("paid_date", "")
        is_paid = bool(data.get("is_paid", False))
        notes = data.get("notes", "")
        payment_method_id = data.get("payment_method")
        lines_data = data.get("lines", [])

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
        if not lines_data:
            errors["lines"] = ["At least one line item is required."]
        else:
            types = {Category.objects.filter(pk=l.get("category")).values_list("category_type", flat=True).first() for l in lines_data if l.get("category")}
            types.discard(None)
            if len(types) > 1:
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
                is_paid=is_paid,
                notes=notes,
                payment_method=payment_method,
            )
            for line in lines_data:
                cat = get_object_or_404(Category, pk=line["category"], budget=self.budget)
                TransactionLine.objects.create(
                    transaction=txn,
                    category=cat,
                    amount=line.get("amount", "0.00"),
                    description=line.get("description", ""),
                )

        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category").get(pk=txn.pk)
        return JsonResponse(serialize_transaction(txn), status=201)


class TransactionDetailView(BudgetMemberMixin, View):
    def get(self, request, budget_pk, pk):
        txn = get_object_or_404(
            Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category"),
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
        data = _parse_json_body(request)

        if "description" in data:
            txn.description = data["description"]
        if "due_date" in data:
            txn.due_date = datetime.date.fromisoformat(data["due_date"])
        if "paid_date" in data:
            txn.paid_date = datetime.date.fromisoformat(data["paid_date"]) if data["paid_date"] else None
        if "is_paid" in data:
            txn.is_paid = bool(data["is_paid"])
        if "notes" in data:
            txn.notes = data["notes"]
        if "payment_method" in data:
            pm_id = data["payment_method"]
            txn.payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None

        lines_data = data.get("lines")
        with db_transaction.atomic():
            txn.save()
            if lines_data is not None:
                txn.lines.all().delete()
                for line in lines_data:
                    cat = get_object_or_404(Category, pk=line["category"], budget=self.budget)
                    TransactionLine.objects.create(
                        transaction=txn,
                        category=cat,
                        amount=line.get("amount", "0.00"),
                        description=line.get("description", ""),
                    )

        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category").get(pk=txn.pk)
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
        transaction.is_paid = not transaction.is_paid
        transaction.paid_date = datetime.date.today() if transaction.is_paid else None
        transaction.save(update_fields=["is_paid", "paid_date"])
        # Support both Inertia (redirect) and JSON (fetch) callers
        if request.headers.get("X-Inertia"):
            next_url = request.POST.get("next") or reverse(
                "budget:detail", kwargs={"budget_pk": budget_pk}
            )
            return redirect(next_url)
        return JsonResponse(serialize_transaction(
            Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category").get(pk=pk)
        ))


# ---------------------------------------------------------------------------
# Recurring Transactions
# ---------------------------------------------------------------------------


class RecurringListView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        qs = RecurringTransaction.objects.filter(budget=self.budget).select_related("category", "payment_method")
        return inertia_render(request, "RecurringList", {
            "budget_pk": self.budget.pk,
            "recurring_transactions": [serialize_recurring(rt) for rt in qs],
        })


class RecurringCreateView(BudgetMemberMixin, View):
    def get(self, request, budget_pk):
        categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
        payment_methods = PaymentMethod.objects.filter(budget=self.budget, is_active=True)
        return inertia_render(request, "RecurringForm", {
            "budget_pk": self.budget.pk,
            "recurring": None,
            "categories": [serialize_category(c) for c in categories],
            "payment_methods": [serialize_payment_method(pm) for pm in payment_methods],
            "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
        })

    def post(self, request, budget_pk):
        data = _parse_json_body(request)
        errors = self._validate(data)
        if errors:
            categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
            payment_methods = PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            return inertia_render(request, "RecurringForm", {
                "budget_pk": self.budget.pk,
                "recurring": None,
                "categories": [serialize_category(c) for c in categories],
                "payment_methods": [serialize_payment_method(pm) for pm in payment_methods],
                "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
                "errors": errors,
                "values": data,
            }, status=422)

        rt = self._create(request, data)
        messages.success(request, "Recurring transaction created.")
        return redirect(reverse("budget:recurring-detail", kwargs={"budget_pk": budget_pk, "pk": rt.pk}))

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
    def get(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        instances = (
            Transaction.objects.filter(recurring=rt)
            .select_related("payment_method")
            .prefetch_related("lines__category")
            .order_by("due_date")
        )
        categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
        payment_methods = PaymentMethod.objects.filter(budget=self.budget, is_active=True)
        return inertia_render(request, "RecurringDetail", {
            "budget_pk": self.budget.pk,
            "recurring": serialize_recurring(rt),
            "instances": [serialize_transaction(t) for t in instances],
            "categories": [serialize_category(c) for c in categories],
            "payment_methods": [serialize_payment_method(pm) for pm in payment_methods],
            "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
        })

    def patch(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        data = _parse_json_body(request)
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

        if data.get("delete_future_unpaid"):
            today = datetime.date.today()
            Transaction.objects.filter(recurring=rt, is_paid=False, due_date__gt=today).delete()
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
        data = _parse_json_body(request)
        due_date_str = data.get("due_date", "")
        if not due_date_str:
            return JsonResponse({"errors": {"due_date": ["This field is required."]}}, status=400)
        try:
            due_date = datetime.date.fromisoformat(due_date_str)
        except ValueError:
            return JsonResponse({"errors": {"due_date": ["Enter a valid date."]}}, status=400)
        txn = Transaction.objects.create(
            budget=self.budget,
            recurring=rt,
            description=data.get("description") or rt.name,
            due_date=due_date,
            created_by=request.user,
            is_paid=False,
            payment_method=rt.payment_method,
        )
        txn = Transaction.objects.select_related("recurring__category", "payment_method").prefetch_related("lines__category").get(pk=txn.pk)
        return JsonResponse(serialize_transaction(txn), status=201)

    def delete(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        if request.GET.get("permanent"):
            rt.delete()
            return JsonResponse({}, status=204)
        today = datetime.date.today()
        if request.GET.get("delete_future_unpaid"):
            Transaction.objects.filter(recurring=rt, is_paid=False, due_date__gt=today).delete()
        rt.is_active = False
        rt.end_date = today
        rt.save(update_fields=["is_active", "end_date"])
        return JsonResponse({}, status=204)


class RecurringUpdateView(BudgetMemberMixin, View):
    def get(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
        payment_methods = PaymentMethod.objects.filter(budget=self.budget, is_active=True)
        return inertia_render(request, "RecurringForm", {
            "budget_pk": self.budget.pk,
            "recurring": serialize_recurring(rt),
            "categories": [serialize_category(c) for c in categories],
            "payment_methods": [serialize_payment_method(pm) for pm in payment_methods],
            "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
        })

    def post(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        data = _parse_json_body(request)
        creator = RecurringCreateView()
        creator.budget = self.budget
        errors = creator._validate(data)
        if errors:
            categories = Category.objects.filter(budget=self.budget).order_by("category_type", "name")
            payment_methods = PaymentMethod.objects.filter(budget=self.budget, is_active=True)
            return inertia_render(request, "RecurringForm", {
                "budget_pk": self.budget.pk,
                "recurring": serialize_recurring(rt),
                "categories": [serialize_category(c) for c in categories],
                "payment_methods": [serialize_payment_method(pm) for pm in payment_methods],
                "freq_choices": [{"value": v, "label": l} for v, l in RecurringTransaction.FREQ_CHOICES],
                "errors": errors,
                "values": data,
            }, status=422)

        pm_id = data.get("payment_method")
        rt.payment_method = PaymentMethod.objects.filter(pk=pm_id, budget=self.budget).first() if pm_id else None
        rt.category = get_object_or_404(Category, pk=data["category"], budget=self.budget)
        rt.name = data["name"].strip()
        rt.description = data.get("description", "")
        rt.amount = data["amount"]
        rt.frequency = data["frequency"]
        rt.interval = int(data.get("interval", 1))
        rt.start_date = datetime.date.fromisoformat(data["start_date"])
        rt.end_date = datetime.date.fromisoformat(data["end_date"]) if data.get("end_date") else None
        rt.is_active = data.get("is_active", True)
        rt.save()

        if data.get("delete_future_unpaid"):
            today = datetime.date.today()
            Transaction.objects.filter(recurring=rt, is_paid=False, due_date__gt=today).delete()
            rt.generated_through = None
            rt.save(update_fields=["generated_through"])
            lookahead = getattr(django_settings, "BUDGET_RECURRING_LOOKAHEAD_MONTHS", 3)
            today = datetime.date.today()
            year = today.year + (today.month + lookahead - 1) // 12
            month = (today.month + lookahead - 1) % 12 + 1
            through_date = today.replace(year=year, month=month, day=calendar.monthrange(year, month)[1])
            rt.generate_instances_up_to(through_date)
            messages.success(request, "Schedule updated and future unpaid instances regenerated.")
        else:
            messages.success(request, "Schedule updated.")

        return redirect(reverse("budget:recurring-detail", kwargs={"budget_pk": budget_pk, "pk": rt.pk}))


class RecurringDeleteView(BudgetMemberMixin, View):
    def post(self, request, budget_pk, pk):
        rt = get_object_or_404(RecurringTransaction, pk=pk, budget=self.budget)
        if request.POST.get("delete_future_unpaid"):
            today = datetime.date.today()
            Transaction.objects.filter(recurring=rt, is_paid=False, due_date__gt=today).delete()
        rt.is_active = False
        rt.end_date = datetime.date.today()
        rt.save(update_fields=["is_active", "end_date"])
        messages.success(request, "Recurring transaction deactivated.")
        return redirect(reverse("budget:recurring-list", kwargs={"budget_pk": budget_pk}))
