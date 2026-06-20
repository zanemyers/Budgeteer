import calendar
import datetime
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q, Sum
from django.db.models.constraints import UniqueConstraint


class Budget(models.Model):
    name = models.CharField(max_length=150, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_budgets",
    )
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="BudgetMembership",
        related_name="budgets",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        names = ", ".join(
            m.get_full_name() or m.email
            for m in self.members.all()[:3]
        )
        return f"Budget ({names})" if names else f"Budget #{self.pk}"


class BudgetMembership(models.Model):
    ROLE_OWNER = "owner"
    ROLE_MEMBER = "member"
    ROLE_CHOICES = [
        (ROLE_OWNER, "Owner"),
        (ROLE_MEMBER, "Member"),
    ]

    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="budget_memberships",
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("budget", "user")]
        ordering = ["joined_at"]

    def __str__(self) -> str:
        return f"{self.user} — {self.budget} ({self.role})"


class Category(models.Model):
    TYPE_INCOME = "income"
    TYPE_EXPENSE = "expense"
    TYPE_CHOICES = [
        (TYPE_INCOME, "Income"),
        (TYPE_EXPENSE, "Expense"),
    ]

    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="categories")
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
        help_text="Optional parent category. Subcategories cannot have children of their own.",
    )
    name = models.CharField(max_length=100)
    category_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    monthly_budget = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_categories",
    )

    class Meta:
        ordering = ["category_type", "name"]
        constraints = [
            UniqueConstraint(
                fields=["budget", "name", "category_type"],
                condition=Q(parent__isnull=True),
                name="unique_root_category_per_budget_type",
            ),
            UniqueConstraint(
                fields=["parent", "name"],
                condition=Q(parent__isnull=False),
                name="unique_subcategory_per_parent",
            ),
        ]

    def __str__(self) -> str:
        if self.parent_id:
            return f"{self.parent.name} → {self.name}"
        return f"{self.name} ({self.get_category_type_display()})"

    def clean(self):
        super().clean()
        if self.parent_id:
            parent = self.parent
            if parent.parent_id:
                raise ValidationError({"parent": "Subcategories cannot have their own subcategories."})
            if parent.budget_id != self.budget_id:
                raise ValidationError({"parent": "Parent must be in the same budget."})
            if parent.category_type != self.category_type:
                raise ValidationError({"category_type": "Subcategory type must match its parent."})

    def save(self, *args, **kwargs):
        if self.parent_id and self.parent.category_type:
            # Inherit type from parent so reporting groups never split.
            self.category_type = self.parent.category_type
        super().save(*args, **kwargs)

    @property
    def is_goal(self) -> bool:
        try:
            return self.goal is not None
        except Goal.DoesNotExist:
            return False

    @property
    def goal_target(self):
        g = getattr(self, "goal", None)
        return g.target if g else None

    @property
    def goal_due_date(self):
        g = getattr(self, "goal", None)
        return g.due_date if g else None

    @property
    def goal_ongoing(self) -> bool:
        g = getattr(self, "goal", None)
        return bool(g and g.ongoing)

    @property
    def goal_monthly(self):
        g = getattr(self, "goal", None)
        return g.monthly_goal if g else None


class Goal(models.Model):
    """Optional details for a Category that's a savings goal."""

    category = models.OneToOneField(
        Category,
        on_delete=models.CASCADE,
        related_name="goal",
        primary_key=True,
    )
    target = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    ongoing = models.BooleanField(default=False)
    monthly_goal = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.category.name} goal — target {self.target}"


class RecurringTransaction(models.Model):
    FREQ_MONTHLY = "monthly"
    FREQ_EVERY_N = "every_n_months"
    FREQ_ANNUALLY = "annually"
    FREQ_CHOICES = [
        (FREQ_MONTHLY, "Monthly"),
        (FREQ_EVERY_N, "Every N Months"),
        (FREQ_ANNUALLY, "Annually"),
    ]

    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="recurring_transactions")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="recurring_transactions")
    payment_method = models.ForeignKey(
        "PaymentMethod", null=True, blank=True, on_delete=models.SET_NULL, related_name="recurring_transactions"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_recurring_transactions",
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(max_length=20, choices=FREQ_CHOICES)
    interval = models.PositiveSmallIntegerField(
        default=1,
        help_text="Number of months between occurrences. Used only when frequency is 'Every N Months'.",
    )
    start_date = models.DateField(help_text="Date of the first occurrence.")
    end_date = models.DateField(null=True, blank=True, help_text="No new instances are generated after this date.")
    is_active = models.BooleanField(default=True)
    generated_through = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_frequency_display()})"

    def next_due_date_after(self, reference_date: datetime.date) -> datetime.date | None:
        """Return the next due date strictly after reference_date, or None if past end_date."""
        date = self.start_date
        while date <= reference_date:
            date = self._advance(date)
        if self.end_date and date > self.end_date:
            return None
        return date

    def _advance(self, date: datetime.date) -> datetime.date:
        """Advance date by one recurrence interval."""
        if self.frequency == self.FREQ_MONTHLY:
            months = 1
        elif self.frequency == self.FREQ_EVERY_N:
            months = self.interval
        else:  # annually
            months = 12
        month = date.month + months
        year = date.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        day = min(date.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)

    def generate_instances_up_to(self, through_date: datetime.date) -> list["Transaction"]:
        """Generate Transaction instances (with TransactionLines) up to through_date.

        Returns new instances created. Existing instances without lines have a line backfilled
        so every Transaction in the system has a canonical line structure.
        """
        from apps.base.models import Currency as CurrencyModel
        from apps.budget.models import Transaction, TransactionLine

        start = self.generated_through if self.generated_through else self.start_date - datetime.timedelta(days=1)

        due_dates: list[datetime.date] = []
        candidate = self.start_date
        while candidate <= through_date:
            if candidate > start:
                if self.end_date is None or candidate <= self.end_date:
                    due_dates.append(candidate)
            candidate = self._advance(candidate)

        # RecurringTransaction.amount is stored in the creator's currency. Resolve once.
        currency_code = getattr(self.created_by, "currency", None) or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency_code).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")
        amount = Decimal(str(self.amount))

        created: list[Transaction] = []
        for due_date in due_dates:
            transaction, is_new = Transaction.objects.get_or_create(
                recurring=self,
                due_date=due_date,
                defaults={
                    "budget": self.budget,
                    "created_by": self.created_by,
                    "description": self.name,
                    "payment_method": self.payment_method,
                    "currency": currency_code,
                    "exchange_rate_to_usd": exchange_rate,
                },
            )
            if is_new:
                created.append(transaction)
            if not transaction.lines.exists():
                TransactionLine.objects.create(
                    transaction=transaction,
                    category=self.category,
                    amount=amount,
                    amount_usd=amount / exchange_rate if exchange_rate else amount,
                )

        if due_dates:
            self.generated_through = due_dates[-1]
            self.save(update_fields=["generated_through"])

        return created


class Transaction(models.Model):
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="transactions")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_transactions",
    )
    recurring = models.ForeignKey(
        RecurringTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="instances",
    )
    payment_method = models.ForeignKey(
        "PaymentMethod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    description = models.CharField(max_length=200)
    due_date = models.DateField()
    paid_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    transaction_type = models.CharField(max_length=10, blank=True, default="")
    currency = models.CharField(max_length=3, default="USD")
    exchange_rate_to_usd = models.DecimalField(max_digits=20, decimal_places=8, default=Decimal("1"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-due_date"]

    def __str__(self) -> str:
        return f"{self.description} — {self.due_date}"

    @property
    def total_amount(self) -> Decimal:
        return self.lines.aggregate(total=Sum("amount"))["total"] or Decimal("0.00")

    def derive_transaction_type(self) -> str:
        if self.transaction_type:
            return self.transaction_type
        first_line = self.lines.select_related("category").first()
        return first_line.category.category_type if first_line else ""


class PaymentMethod(models.Model):
    TYPE_CREDIT = "credit_card"
    TYPE_DEBIT = "debit_card"
    TYPE_CASH = "cash"
    TYPE_BANK = "bank_transfer"
    TYPE_DIRECT_DEPOSIT = "direct_deposit"
    TYPE_OTHER = "other"
    TYPE_CHOICES = [
        (TYPE_CREDIT, "Credit Card"),
        (TYPE_DEBIT, "Debit Card"),
        (TYPE_CASH, "Cash"),
        (TYPE_BANK, "Bank Transfer"),
        (TYPE_DIRECT_DEPOSIT, "Direct Deposit"),
        (TYPE_OTHER, "Other"),
    ]

    budget = models.ForeignKey(
        "Budget",
        on_delete=models.CASCADE,
        related_name="payment_methods",
    )
    name = models.CharField(max_length=100)
    payment_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_OTHER)
    last_four = models.CharField(max_length=4, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        suffix = f" ···{self.last_four}" if self.last_four else ""
        return f"{self.name}{suffix}"


class CategoryBudget(models.Model):
    """Monthly spending target assigned to a category."""

    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="category_budgets")
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="category_budgets")
    month = models.DateField(help_text="First day of the month this assignment applies to.")
    assigned = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        unique_together = [("budget", "category", "month")]
        ordering = ["month", "category__name"]

    def __str__(self) -> str:
        return f"{self.category.name} — {self.month:%Y-%m}: {self.assigned}"


class TransactionLine(models.Model):
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="lines")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="transaction_lines")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    amount_usd = models.DecimalField(max_digits=14, decimal_places=6)
    description = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["category__name"]

    def __str__(self) -> str:
        return f"{self.category.name}: {self.amount}"
