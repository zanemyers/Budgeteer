from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0005_add_payment_method"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="monthly_budget",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10),
        ),
    ]
