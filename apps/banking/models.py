from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.base.fields import EncryptedTextField


class SimpleFINConnection(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="simplefin_connections",
    )
    label = models.CharField(max_length=100, blank=True, default="")
    access_url = EncryptedTextField()
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "base_simplefinconnection"
        ordering = ["-created_at"]
        verbose_name = "SimpleFIN Connection"
        verbose_name_plural = "SimpleFIN Connections"

    def __str__(self) -> str:
        return self.label or f"SimpleFIN connection #{self.pk}"

    @property
    def sync_status(self) -> str:
        """Derived: 'pending' before first sync, 'error' if last attempt failed, else 'ok'."""
        if self.last_synced_at is None:
            return "pending"
        return "error" if self.last_sync_error else "ok"


class BankAccount(models.Model):
    """An account at a financial institution surfaced by a SimpleFIN connection."""

    connection = models.ForeignKey(
        SimpleFINConnection,
        on_delete=models.CASCADE,
        related_name="bank_accounts",
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
    is_hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "base_bankaccount"
        unique_together = [("connection", "simplefin_id")]
        ordering = ["org_name", "name"]

    def __str__(self) -> str:
        return f"{self.org_name} — {self.name}" if self.org_name else self.name


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
        choices=Status.choices,
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

    class Meta:
        db_table = "base_banktransaction"
        unique_together = [("bank_account", "simplefin_id")]
        ordering = ["-posted_at"]
        indexes = [
            models.Index(fields=["status", "posted_at"], name="base_banktr_status_980c92_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.posted_at:%Y-%m-%d} {self.description} {self.amount}"
