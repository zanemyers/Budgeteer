from django.conf import settings
from django.db import models

from apps.base.fields import EncryptedTextField


class Currency(models.Model):
    code = models.CharField(max_length=3, primary_key=True)
    name = models.CharField(max_length=64)
    symbol = models.CharField(max_length=8, default="")
    rate_to_usd = models.DecimalField(max_digits=20, decimal_places=8, default=1)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["code"]
        verbose_name_plural = "currencies"

    def __str__(self):
        return f"{self.code} — {self.name}"


class SimpleFINConnection(models.Model):
    class SyncStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        OK = "ok", "OK"
        ERROR = "error", "Error"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="simplefin_connections",
    )
    label = models.CharField(max_length=100, blank=True, default="")
    access_url = EncryptedTextField()
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(
        max_length=10,
        choices=SyncStatus.choices,
        default=SyncStatus.PENDING,
    )
    last_sync_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.label or f"SimpleFIN connection #{self.pk}"
