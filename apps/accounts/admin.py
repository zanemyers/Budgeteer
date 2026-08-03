from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from unfold.admin import ModelAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    list_display = ("email", "first_name", "last_name", "is_staff")
    ordering = ("email",)
    fieldsets = (BaseUserAdmin.fieldsets or ()) + (
        (
            "Budgeteer",
            {
                "fields": (
                    "currency",
                    "timezone",
                    "default_budget",
                    "avatar_thumbnail",
                ),
            },
        ),
    )
