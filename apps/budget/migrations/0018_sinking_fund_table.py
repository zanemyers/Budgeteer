import django.db.models.deletion
from django.db import migrations, models


def backfill_sinking_funds(apps, schema_editor):
    Category = apps.get_model("budget", "Category")
    SinkingFund = apps.get_model("budget", "SinkingFund")
    rows = []
    for cat in Category.objects.filter(is_sinking_fund=True).iterator():
        if cat.sinking_fund_target is None:
            continue
        rows.append(
            SinkingFund(
                category_id=cat.pk,
                target=cat.sinking_fund_target,
                due_date=cat.sinking_fund_due_date,
                ongoing=cat.sinking_fund_ongoing,
                monthly_goal=cat.sinking_fund_monthly_goal,
            )
        )
        if len(rows) >= 500:
            SinkingFund.objects.bulk_create(rows)
            rows = []
    if rows:
        SinkingFund.objects.bulk_create(rows)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0017_drop_transaction_is_paid"),
    ]

    operations = [
        migrations.CreateModel(
            name="SinkingFund",
            fields=[
                (
                    "category",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="sinking_fund",
                        serialize=False,
                        to="budget.category",
                    ),
                ),
                ("target", models.DecimalField(max_digits=12, decimal_places=2)),
                ("due_date", models.DateField(null=True, blank=True)),
                ("ongoing", models.BooleanField(default=False)),
                ("monthly_goal", models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)),
            ],
        ),
        migrations.RunPython(backfill_sinking_funds, noop_reverse),
        migrations.RemoveField(model_name="category", name="is_sinking_fund"),
        migrations.RemoveField(model_name="category", name="sinking_fund_target"),
        migrations.RemoveField(model_name="category", name="sinking_fund_due_date"),
        migrations.RemoveField(model_name="category", name="sinking_fund_ongoing"),
        migrations.RemoveField(model_name="category", name="sinking_fund_monthly_goal"),
    ]
