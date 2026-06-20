from django.contrib import admin

from unfold.admin import ModelAdmin

from apps.investments.models import Holding


@admin.register(Holding)
class HoldingAdmin(ModelAdmin):
    list_display = ["__str__", "bank_account", "symbol", "shares", "market_value", "cost_basis", "updated_at"]
    list_filter = ["currency"]
    search_fields = ["symbol", "description", "simplefin_id"]
    readonly_fields = ["created_at", "updated_at", "simplefin_id", "raw"]
