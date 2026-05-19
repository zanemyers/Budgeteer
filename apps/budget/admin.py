from django.contrib import admin

from unfold.admin import ModelAdmin, StackedInline, TabularInline

from apps.budget.models import Category, SinkingFund


class SubcategoryInline(TabularInline):
    model = Category
    fk_name = "parent"
    extra = 0
    fields = ["name", "monthly_budget"]
    show_change_link = True
    verbose_name = "Subcategory"
    verbose_name_plural = "Subcategories"


class SinkingFundInline(StackedInline):
    model = SinkingFund
    extra = 0
    fields = ["target", "due_date", "ongoing", "monthly_goal"]


@admin.register(Category)
class CategoryAdmin(ModelAdmin):
    list_display = ["__str__", "category_type", "budget", "monthly_budget", "is_sinking_fund_display"]
    list_filter = ["category_type", "budget"]
    search_fields = ["name", "parent__name"]
    autocomplete_fields = ["parent"]
    list_select_related = ["parent", "budget", "sinking_fund"]
    inlines = [SubcategoryInline, SinkingFundInline]

    def get_inlines(self, request, obj=None):
        # Only root categories can have subcategories — hide the inline on subcategory edits.
        if obj and obj.parent_id:
            return [SinkingFundInline]
        return super().get_inlines(request, obj)

    def get_queryset(self, request):
        # Show roots first; subcategories indented via __str__.
        return super().get_queryset(request).order_by("budget", "category_type", "parent__name", "name")

    @admin.display(description="Sinking fund", boolean=True)
    def is_sinking_fund_display(self, obj):
        return obj.is_sinking_fund
