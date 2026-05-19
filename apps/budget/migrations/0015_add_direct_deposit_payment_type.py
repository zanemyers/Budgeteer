from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0014_alter_category_unique_together_category_parent_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="paymentmethod",
            name="payment_type",
            field=models.CharField(
                choices=[
                    ("credit_card", "Credit Card"),
                    ("debit_card", "Debit Card"),
                    ("cash", "Cash"),
                    ("bank_transfer", "Bank Transfer"),
                    ("direct_deposit", "Direct Deposit"),
                    ("other", "Other"),
                ],
                default="other",
                max_length=20,
            ),
        ),
    ]
