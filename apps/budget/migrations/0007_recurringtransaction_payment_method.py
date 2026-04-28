import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("budget", "0006_category_monthly_budget"),
    ]

    operations = [
        migrations.AddField(
            model_name="recurringtransaction",
            name="payment_method",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="recurring_transactions",
                to="budget.paymentmethod",
            ),
        ),
    ]
