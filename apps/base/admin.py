from django.contrib import admin

from unfold.admin import ModelAdmin

from apps.base.models import Currency

admin.site.index_template = "admin/budgeteer_index.html"


@admin.register(Currency)
class CurrencyAdmin(ModelAdmin):
    list_display = ["code", "name", "symbol", "rate_to_usd", "updated_at"]
    search_fields = ["code", "name"]
