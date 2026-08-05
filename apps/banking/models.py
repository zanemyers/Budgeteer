import datetime
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.base.fields import EncryptedTextField


class SimpleFINConnection(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="simplefin_connections",
    )
    label = models.CharField(max_length=100, blank=True, default="")
    access_url = EncryptedTextField()
    last_synced_at = models.DateTimeField(null=True, blank=True, help_text="Last attempt, successful or not.")
    last_success_at = models.DateTimeField(null=True, blank=True, help_text="Last attempt that returned data.")
    last_sync_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "SimpleFIN Connection"
        verbose_name_plural = "SimpleFIN Connections"

    def __str__(self) -> str:
        return self.label or f"SimpleFIN connection #{self.pk}"

    # How long a failure is treated as a blip. The bridge stalls past its read timeout every so
    # often and the next attempt succeeds, so one failure says nothing about whether anything is
    # actually wrong. Chosen over inspecting the error text: a persistent fault keeps failing, so
    # it escalates on its own within a day, and no error string has to be pattern-matched.
    STALE_GRACE = datetime.timedelta(hours=24)

    @property
    def sync_status(self) -> str:
        """
        Grade the last attempt.

        'pending' before any attempt, 'ok' when the last one worked, 'stale' when it failed but
        something worked recently, and 'error' once it has been failing long enough to act on.

        Every failure used to be 'error', which the Banking page renders as a red alert. A single
        read timeout therefore looked exactly like a revoked access URL, and since only a later
        success clears the message and the cron runs every six hours, it sat there for most of a
        day over nothing.
        """
        if self.last_synced_at is None:
            return "pending"
        if not self.last_sync_error:
            return "ok"
        if self.last_success_at and timezone.now() - self.last_success_at < self.STALE_GRACE:
            return "stale"
        return "error"


class BankAccount(models.Model):
    """An account at a financial institution surfaced by a SimpleFIN connection."""

    # Null for an account that came from an uploaded file rather than a sync. Imported rows need
    # somewhere to hang so they can use the same awaiting-review pipeline as synced ones, and
    # requiring a SimpleFIN connection for that would mean inventing a fake one.
    connection = models.ForeignKey(
        SimpleFINConnection,
        on_delete=models.CASCADE,
        related_name="bank_accounts",
        null=True,
        blank=True,
    )
    simplefin_id = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    org_name = models.CharField(max_length=255, blank=True, default="")
    org_domain = models.CharField(max_length=255, blank=True, default="")
    currency = models.CharField(max_length=3, default="USD")
    balance = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    available_balance = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    balance_as_of = models.DateTimeField(null=True, blank=True)
    payment_method = models.ForeignKey(
        "budget.PaymentMethod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_accounts",
    )
    # Set only for an imported account, where it is the sole link back to a budget. A synced account
    # reaches its budget through payment_method, but an import may not know the account at all — the
    # file could have come from another budgeting tool covering several — and without this those rows
    # belong to nothing and cannot be listed.
    budget = models.ForeignKey(
        "budget.Budget",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="imported_bank_accounts",
    )
    is_hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Postgres treats NULLs as distinct in a unique constraint, so unique_together alone stops
        # enforcing anything once connection can be null. The partial constraint covers the imported
        # case, where simplefin_id already carries the payment method's own primary key.
        unique_together = [("connection", "simplefin_id")]
        constraints = [
            models.UniqueConstraint(
                fields=["simplefin_id"],
                condition=models.Q(connection__isnull=True),
                name="unique_imported_bank_account",
            ),
        ]
        ordering = ["org_name", "name"]

    @property
    def is_imported(self) -> bool:
        return self.connection_id is None

    def __str__(self) -> str:
        return f"{self.org_name} — {self.name}" if self.org_name else self.name


class BalanceSnapshot(models.Model):
    """
    One balance reading for an account, kept so the series survives.

    `BankAccount.balance` is overwritten in place by every sync, and the sync runs four times a
    day, so the previous reading was discarded as fast as the next one arrived. Nothing could be
    reconstructed after the fact — net worth over time needs the history, and history is the one
    thing you cannot backfill later.

    Keyed on the bridge's own `balance-date` rather than when we happened to ask, so four syncs
    of an unchanged daily balance record one reading, not four. When a reading for a timestamp we
    already hold comes back with a different amount, the newer amount wins.
    """

    bank_account = models.ForeignKey(BankAccount, on_delete=models.CASCADE, related_name="balance_snapshots")
    balance = models.DecimalField(max_digits=16, decimal_places=2)
    available_balance = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    as_of = models.DateTimeField(help_text="The bridge's balance-date, or the sync time if it sent none.")
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bank_account", "as_of"], name="unique_balance_snapshot_per_as_of"),
        ]
        indexes = [models.Index(fields=["bank_account", "-as_of"], name="balance_snapshot_account_asof")]
        ordering = ["-as_of"]

    def __str__(self) -> str:
        return f"{self.bank_account} at {self.as_of:%Y-%m-%d}: {self.balance}"


class BankTransactionQuerySet(models.QuerySet):
    def for_budget(self, budget, user=None):
        """
        Every row a budget is entitled to see, synced or imported.

        A synced account proves its budget through the payment method it is mapped to. An imported one
        may have no payment method at all — a file from another budgeting tool can cover several
        accounts — so it carries a direct budget link instead.

        Callers used to write this predicate themselves, and every one of them required a connection,
        which excluded every imported row. That made imported rows invisible on the page meant to
        review them, and made the whole confirm flow 404 for them.

        `user` narrows the synced side only, and is not optional in spirit: it keeps a connection
        belonging to someone else from being read through a payment method mapped into this budget.
        The imported side needs no equivalent, since its budget link is the account's own.
        """
        synced = models.Q(bank_account__payment_method__budget=budget)
        if user is not None:
            synced &= models.Q(bank_account__connection__user=user)
        return self.filter(synced | models.Q(bank_account__budget=budget))


class BankTransaction(models.Model):
    """A single transaction pulled from a SimpleFIN account."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        LINKED = "linked", "Linked"
        IGNORED = "ignored", "Ignored"

    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.CASCADE,
        related_name="bank_transactions",
    )
    simplefin_id = models.CharField(max_length=255)
    posted_at = models.DateTimeField()
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    description = models.CharField(max_length=500, blank=True, default="")
    payee = models.CharField(max_length=255, blank=True, default="")
    memo = models.CharField(max_length=500, blank=True, default="")
    is_pending_at_bank = models.BooleanField(default=False)
    raw = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=10,
        choices=Status,
        default=Status.PENDING,
    )
    ignore_reason = models.CharField(max_length=500, blank=True, default="")
    transaction = models.OneToOneField(
        "budget.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_transaction",
    )
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    objects = BankTransactionQuerySet.as_manager()

    class Meta:
        unique_together = [("bank_account", "simplefin_id")]
        ordering = ["-posted_at"]
        indexes = [
            models.Index(fields=["status", "posted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.posted_at:%Y-%m-%d} {self.description} {self.amount}"
