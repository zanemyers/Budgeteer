from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0011_transaction_transaction_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="sinking_fund_ongoing",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="category",
            name="sinking_fund_monthly_goal",
            field=models.DecimalField(decimal_places=2, max_digits=12, null=True, blank=True),
        ),
    ]
