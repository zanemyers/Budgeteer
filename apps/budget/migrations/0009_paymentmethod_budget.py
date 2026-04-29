import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def assign_payment_methods_to_budgets(apps, schema_editor):
    PaymentMethod = apps.get_model("budget", "PaymentMethod")
    BudgetMembership = apps.get_model("budget", "BudgetMembership")

    for pm in PaymentMethod.objects.all():
        membership = BudgetMembership.objects.filter(user_id=pm.user_id, role="owner").first()
        if not membership:
            membership = BudgetMembership.objects.filter(user_id=pm.user_id).first()
        if membership:
            pm.budget_id = membership.budget_id
            pm.save(update_fields=["budget"])
        else:
            pm.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("budget", "0008_budget_name"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="paymentmethod",
            name="budget",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="payment_methods",
                to="budget.budget",
            ),
        ),
        migrations.RunPython(assign_payment_methods_to_budgets, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="paymentmethod",
            name="budget",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="payment_methods",
                to="budget.budget",
            ),
        ),
        migrations.RemoveField(
            model_name="paymentmethod",
            name="user",
        ),
    ]
