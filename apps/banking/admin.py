from django.contrib import admin

from unfold.admin import ModelAdmin

from apps.banking.models import SimpleFINConnection


@admin.register(SimpleFINConnection)
class SimpleFINConnectionAdmin(ModelAdmin):
    list_display = ["__str__", "user", "sync_status", "last_synced_at", "created_at"]
    readonly_fields = ["created_at", "updated_at"]
    exclude = ["access_url"]

    @admin.display(description="Sync status")
    def sync_status(self, obj):
        return obj.sync_status