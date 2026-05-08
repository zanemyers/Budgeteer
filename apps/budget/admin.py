from django.contrib import admin

from unfold.admin import ModelAdmin, TabularInline

from apps.budget.models import Category


class SubcategoryInline(TabularInline):
    model = Category
    fk_name = "parent"
    extra = 0
    fields = ["name", "monthly_budget", "is_sinking_fund"]
    show_change_link = True
    verbose_name = "Subcategory"
    verbose_name_plural = "Subcategories"


@admin.register(Category)
class CategoryAdmin(ModelAdmin):
    list_display = ["__str__", "category_type", "budget", "monthly_budget", "is_sinking_fund"]
    list_filter = ["category_type", "is_sinking_fund", "budget"]
    search_fields = ["name", "parent__name"]
    autocomplete_fields = ["parent"]
    list_select_related = ["parent", "budget"]
    inlines = [SubcategoryInline]

    def get_inlines(self, request, obj=None):
        # Only root categories can have subcategories — hide the inline on subcategory edits.
        if obj and obj.parent_id:
            return []
        return super().get_inlines(request, obj)

    def get_queryset(self, request):
        # Show roots first; subcategories indented via __str__.
        return super().get_queryset(request).order_by("budget", "category_type", "parent__name", "name")
