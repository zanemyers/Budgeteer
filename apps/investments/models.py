from decimal import Decimal

from django.db import models


class Holding(models.Model):
    """A position within an investment-capable BankAccount, sourced from SimpleFIN."""

    bank_account = models.ForeignKey(
        "banking.BankAccount",
        on_delete=models.CASCADE,
        related_name="holdings",
    )
    simplefin_id = models.CharField(max_length=255)
    symbol = models.CharField(max_length=32, blank=True, default="")
    description = models.CharField(max_length=500, blank=True, default="")
    shares = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("0"))
    cost_basis = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    market_value = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    purchase_price = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    raw = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "investments_holding"
        unique_together = [("bank_account", "simplefin_id")]
        ordering = ["symbol", "description"]

    def __str__(self) -> str:
        return f"{self.symbol or self.description} ({self.shares})"

    @property
    def unrealized_gain(self) -> Decimal | None:
        if self.market_value is None or self.cost_basis is None:
            return None
        return self.market_value - self.cost_basis
