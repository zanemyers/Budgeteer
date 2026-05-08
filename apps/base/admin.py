from django.contrib import admin

from unfold.admin import ModelAdmin

from apps.base.models import Currency, SimpleFINConnection

admin.site.index_template = "admin/budgeteer_index.html"


@admin.register(Currency)
class CurrencyAdmin(ModelAdmin):
    list_display = ["code", "name", "symbol", "rate_to_usd", "updated_at"]
    search_fields = ["code", "name"]


@admin.register(SimpleFINConnection)
class SimpleFINConnectionAdmin(ModelAdmin):
    list_display = ["__str__", "user", "last_sync_status", "last_synced_at", "created_at"]
    list_filter = ["last_sync_status"]
    readonly_fields = ["created_at", "updated_at"]
    exclude = ["access_url"]
