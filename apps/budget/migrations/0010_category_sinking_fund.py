from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0009_paymentmethod_budget"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="is_sinking_fund",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="category",
            name="sinking_fund_target",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="category",
            name="sinking_fund_due_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
