from django.contrib import admin

from unfold.admin import ModelAdmin

from apps.banking.models import BankAccount, BankTransaction, SimpleFINConnection


@admin.register(SimpleFINConnection)
class SimpleFINConnectionAdmin(ModelAdmin):
    list_display = ["__str__", "user", "sync_status", "last_synced_at", "created_at"]
    readonly_fields = ["created_at", "updated_at"]
    exclude = ["access_url"]

    @admin.display(description="Sync status")
    def sync_status(self, obj):
        return obj.sync_status


@admin.register(BankAccount)
class BankAccountAdmin(ModelAdmin):
    list_display = ["__str__", "connection", "currency", "balance", "payment_method", "is_hidden", "updated_at"]
    list_filter = ["is_hidden", "currency"]
    search_fields = ["name", "org_name", "simplefin_id"]
    readonly_fields = ["created_at", "updated_at", "simplefin_id"]


@admin.register(BankTransaction)
class BankTransactionAdmin(ModelAdmin):
    list_display = ["__str__", "bank_account", "status", "amount", "posted_at", "transaction"]
    list_filter = ["status", "is_pending_at_bank"]
    search_fields = ["description", "payee", "memo", "simplefin_id"]
    readonly_fields = ["first_seen_at", "last_seen_at", "simplefin_id", "raw"]
