import calendar
import datetime
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db import transaction as db_transaction
from django.db.models import Q, Sum
from django.db.models.constraints import UniqueConstraint


def add_months(d: datetime.date, months: int) -> datetime.date:
    """Return `d` shifted forward by `months`, clamping the day to the target month."""
    month = d.month + months
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return datetime.date(year, month, day)


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
        names = ", ".join(m.get_full_name() or m.email for m in self.members.all()[:3])
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


class PaySchedule(models.Model):
    """
    A named income source (a job) and which budget month its paychecks fund.

    A budget can have several — e.g. one per job or per spouse. `frequency` and the
    anchor fields describe *how* the user is paid (for payday projection and UI).
    Month allocation is driven by `allocation_offset_months`: 0 = income funds the
    month it's received, 1 = the following month (budgeting a month ahead).

    A paycheck is matched to a schedule by `expected_amount` and/or `match_text`
    (a substring of the transaction description or bank payee) — both known at
    entry/sync time, before the income has been categorized.
    """

    FREQ_MONTHLY = "monthly"
    FREQ_SEMIMONTHLY = "semimonthly"
    FREQ_BIWEEKLY = "biweekly"
    FREQ_WEEKLY = "weekly"
    FREQ_CHOICES = [
        (FREQ_MONTHLY, "Once a month"),
        (FREQ_SEMIMONTHLY, "Twice a month"),
        (FREQ_BIWEEKLY, "Every two weeks"),
        (FREQ_WEEKLY, "Weekly"),
    ]

    ANCHOR_BEGINNING = "beginning"
    ANCHOR_MIDDLE = "middle"
    ANCHOR_END = "end"
    ANCHOR_CHOICES = [
        (ANCHOR_BEGINNING, "Beginning of the month"),
        (ANCHOR_MIDDLE, "Middle of the month"),
        (ANCHOR_END, "End of the month"),
    ]

    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="pay_schedules")
    name = models.CharField(max_length=100, help_text="Label for this income source, e.g. the job it belongs to.")
    category = models.ForeignKey(
        "Category",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pay_schedules",
        help_text="Income category a matched paycheck should be recorded under.",
    )
    payment_method = models.ForeignKey(
        "PaymentMethod",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pay_schedules",
        help_text="Account a paycheck from this schedule is deposited into.",
    )
    frequency = models.CharField(max_length=20, choices=FREQ_CHOICES, default=FREQ_MONTHLY)
    anchor_1 = models.CharField(
        max_length=10,
        choices=ANCHOR_CHOICES,
        blank=True,
        default="",
        help_text="First payday of the month (monthly / twice-a-month schedules).",
    )
    anchor_2 = models.CharField(
        max_length=10,
        choices=ANCHOR_CHOICES,
        blank=True,
        default="",
        help_text="Second payday of the month, for twice-a-month schedules.",
    )
    anchor_date = models.DateField(
        null=True,
        blank=True,
        help_text="A reference payday, used to project every-two-weeks / weekly paydays.",
    )
    allocation_offset_months = models.PositiveSmallIntegerField(
        default=0,
        help_text="0 = income funds the month it's received; 1 = funds the following month.",
    )
    expected_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Approximate paycheck amount. Also used to match income to this schedule.",
    )
    match_text = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="If the transaction description or bank payee contains this text, it matches this schedule.",
    )
    generated_through = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_frequency_display()})"

    def _anchor_day(self, anchor: str, year: int, month: int) -> int | None:
        """Resolve a semantic anchor (beginning/middle/end) to a day in a given month."""
        if anchor == self.ANCHOR_BEGINNING:
            return 1
        if anchor == self.ANCHOR_MIDDLE:
            return 15
        if anchor == self.ANCHOR_END:
            return calendar.monthrange(year, month)[1]
        return None

    def budget_month_for(self, received_date: datetime.date) -> datetime.date:
        """
        First-of-month a paycheck received on `received_date` should fund.

        For a twice-a-month schedule that budgets a month ahead, only the *later*
        paycheck of the month carries the offset — the earlier (e.g. mid-month) one
        still funds the month it's received, so you don't skip a month.
        """
        offset = self.allocation_offset_months
        if offset and self.frequency == self.FREQ_SEMIMONTHLY and self.anchor_1 and self.anchor_2:
            d1 = self._anchor_day(self.anchor_1, received_date.year, received_date.month)
            d2 = self._anchor_day(self.anchor_2, received_date.year, received_date.month)
            if d1 and d2 and received_date.day <= (min(d1, d2) + max(d1, d2)) / 2:
                offset = 0  # first paycheck of the month — funds the received month
        return add_months(received_date.replace(day=1), offset)

    def paydays_between(self, start: datetime.date, end: datetime.date) -> list[datetime.date]:
        """All payday dates in [start, end] implied by this schedule's cadence."""
        if start > end:
            return []
        dates: list[datetime.date] = []
        if self.frequency in (self.FREQ_BIWEEKLY, self.FREQ_WEEKLY):
            if not self.anchor_date:
                return []
            step = 14 if self.frequency == self.FREQ_BIWEEKLY else 7
            # Walk the cadence from the reference payday to the first date >= start.
            day = self.anchor_date
            if day < start:
                gap = (start - day).days
                day = day + datetime.timedelta(days=((gap + step - 1) // step) * step)
            while day <= end:
                dates.append(day)
                day = day + datetime.timedelta(days=step)
            return dates
        # monthly / semimonthly: resolve anchors within each month of the range
        anchors = [a for a in (self.anchor_1, self.anchor_2) if a]
        if self.frequency == self.FREQ_MONTHLY:
            anchors = anchors[:1]
        if not anchors:
            return []
        cursor = start.replace(day=1)
        while cursor <= end:
            for anchor in anchors:
                day = self._anchor_day(anchor, cursor.year, cursor.month)
                if day:
                    payday = cursor.replace(day=day)
                    if start <= payday <= end:
                        dates.append(payday)
            cursor = add_months(cursor, 1)
        return sorted(dates)

    def generate_instances_up_to(self, through_date: datetime.date, since: datetime.date) -> list["Transaction"]:
        """
        Create pending income Transactions for each payday up to `through_date`.

        Requires a category (an income line needs one). The amount is optional: with no
        `expected_amount` — e.g. variable part-time pay — paychecks are generated as
        pending placeholders (amount 0) to be filled in before they're marked paid.
        `since` floors the first run so we don't backfill history.
        """
        from apps.base.models import Currency as CurrencyModel
        from apps.budget.models import Transaction, TransactionLine

        if self.category_id is None:
            return []

        floor = self.generated_through + datetime.timedelta(days=1) if self.generated_through else since
        paydays = self.paydays_between(floor, through_date)
        if not paydays:
            return []

        creator = self.budget.created_by
        currency_code = getattr(creator, "currency", None) or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency_code).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")
        amount = Decimal(str(self.expected_amount)) if self.expected_amount is not None else Decimal("0.00")

        created: list[Transaction] = []
        for payday in paydays:
            transaction, is_new = Transaction.objects.get_or_create(
                pay_schedule=self,
                due_date=payday,
                defaults={
                    "budget": self.budget,
                    "created_by": creator,
                    "description": self.name,
                    "transaction_type": "income",
                    "payment_method": self.payment_method,
                    "budget_month": self.budget_month_for(payday),
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

        self.generated_through = paydays[-1]
        self.save(update_fields=["generated_through"])

        # Backfill the deposit account onto existing unpaid paychecks generated before this
        # schedule had one assigned. Only fills nulls, preserving any account set manually.
        if self.payment_method_id is not None:
            Transaction.objects.filter(pay_schedule=self, paid_date__isnull=True, payment_method__isnull=True).update(
                payment_method_id=self.payment_method_id
            )

        return created


def _amount_close(a: Decimal, b: Decimal) -> bool:
    """Return True if two amounts are within ~5% (or $1) of each other, ignoring sign."""
    a, b = abs(a), abs(b)
    return abs(a - b) <= max(b * Decimal("0.05"), Decimal("1"))


def match_pay_schedule(budget, *, amount: "Decimal | None" = None, description: str = "") -> "PaySchedule | None":
    """
    Pick the pay schedule a paycheck belongs to, by amount and/or description.

    A schedule with no match criteria acts as a weak default; one with criteria only
    wins when they match. Returns None when nothing matches (caller falls back to the
    received date), so we never silently allocate income to the wrong month.
    """
    text = (description or "").lower()
    best, best_score = None, 0.0
    for schedule in budget.pay_schedules.all():
        if not schedule.expected_amount and not schedule.match_text:
            score = 0.1  # criteria-less default
        else:
            score = 0.0
            if (
                schedule.expected_amount is not None
                and amount is not None
                and _amount_close(amount, schedule.expected_amount)
            ):
                score += 0.5
            if schedule.match_text and schedule.match_text.lower() in text:
                score += 0.5
        if score > best_score:
            best, best_score = schedule, score
    return best if best_score > 0 else None


def default_income_budget_month(
    budget, received_date: datetime.date, *, amount: "Decimal | None" = None, description: str = ""
) -> datetime.date | None:
    """Target budget month for income, per the matched pay schedule (None if none)."""
    schedule = match_pay_schedule(budget, amount=amount, description=description)
    return schedule.budget_month_for(received_date) if schedule else None


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
    is_system = models.BooleanField(default=False)
    rollover = models.BooleanField(
        default=False,
        help_text="Carry this category's leftover balance forward into the next month instead of resetting it.",
    )
    base_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Recurring amount budgeted to a rollover category each month; leftover accrues on top.",
    )
    rollover_start = models.DateField(
        null=True,
        blank=True,
        help_text="First month (1st) the rollover base begins accruing. Set when rollover is enabled.",
    )
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

    TRANSFERS_SYSTEM_NAME = "Transfers"

    @classmethod
    def get_or_create_transfers(cls, budget) -> "Category":
        """Return the per-budget system category used as the placeholder line for transfers."""
        cat, _ = cls.objects.get_or_create(
            budget=budget,
            is_system=True,
            name=cls.TRANSFERS_SYSTEM_NAME,
            defaults={"category_type": cls.TYPE_EXPENSE},
        )
        return cat

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
        """
        Generate Transaction instances (with TransactionLines) up to through_date.

        Returns new instances created. Existing instances without lines have a line backfilled
        so every Transaction in the system has a canonical line structure.
        """
        from apps.base.models import Currency as CurrencyModel
        from apps.budget.models import Transaction, TransactionLine

        start = self.generated_through if self.generated_through else self.start_date - datetime.timedelta(days=1)

        due_dates: list[datetime.date] = []
        candidate = self.start_date
        while candidate <= through_date:
            if candidate > start and (self.end_date is None or candidate <= self.end_date):
                due_dates.append(candidate)
            candidate = self._advance(candidate)

        # RecurringTransaction.amount is stored in the creator's currency. Resolve once.
        currency_code = getattr(self.created_by, "currency", None) or "USD"
        try:
            exchange_rate = CurrencyModel.objects.get(code=currency_code).rate_to_usd
        except CurrencyModel.DoesNotExist:
            exchange_rate = Decimal("1")
        amount = Decimal(str(self.amount))

        is_income = self.category.category_type == Category.TYPE_INCOME

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
                    "budget_month": (
                        default_income_budget_month(self.budget, due_date, amount=self.amount, description=self.name)
                        if is_income
                        else None
                    ),
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

        # Backfill the payment method onto existing unpaid instances that were generated
        # before this schedule had one assigned. Only fills nulls, so a payment method set
        # manually on a specific instance is preserved.
        if self.payment_method_id is not None:
            Transaction.objects.filter(recurring=self, paid_date__isnull=True, payment_method__isnull=True).update(
                payment_method_id=self.payment_method_id
            )

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
    pay_schedule = models.ForeignKey(
        "PaySchedule",
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
    budget_month = models.DateField(
        null=True,
        blank=True,
        help_text="First day of the budget month this transaction funds; overrides paid_date bucketing.",
    )
    notes = models.TextField(blank=True)
    transaction_type = models.CharField(max_length=10, blank=True, default="")
    transfer_partner = models.OneToOneField(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
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
        # Iterate the (usually prefetched) line cache rather than .first(), which
        # builds a fresh queryset that ignores the cache and causes an N+1 when
        # deriving the type across a list of transactions. Meta.ordering
        # (category__name) makes the first cached line match the old .first().
        first_line = next(iter(self.lines.all()), None)
        return first_line.category.category_type if first_line else ""

    def link_transfer(self, partner: "Transaction") -> None:
        """Atomically mark `self` and `partner` as two legs of the same transfer."""
        if partner.pk == self.pk:
            raise ValueError("A transaction can't be its own transfer partner.")
        if partner.budget_id != self.budget_id:
            raise ValueError("Transfer partners must belong to the same budget.")
        with db_transaction.atomic():
            # Clear any existing partnerships on either side first so we don't
            # leave orphan back-references when re-linking.
            if self.transfer_partner_id and self.transfer_partner_id != partner.pk:
                Transaction.objects.filter(pk=self.transfer_partner_id).update(transfer_partner=None)
            if partner.transfer_partner_id and partner.transfer_partner_id != self.pk:
                Transaction.objects.filter(pk=partner.transfer_partner_id).update(transfer_partner=None)
            Transaction.objects.filter(pk=self.pk).update(transfer_partner=partner)
            Transaction.objects.filter(pk=partner.pk).update(transfer_partner=self)
            self.transfer_partner_id = partner.pk
            partner.transfer_partner_id = self.pk

    def unlink_transfer(self) -> None:
        """Clear the transfer partnership on both sides, if any."""
        if not self.transfer_partner_id:
            return
        with db_transaction.atomic():
            partner_pk = self.transfer_partner_id
            Transaction.objects.filter(pk=self.pk).update(transfer_partner=None)
            Transaction.objects.filter(pk=partner_pk).update(transfer_partner=None)
            self.transfer_partner_id = None


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
