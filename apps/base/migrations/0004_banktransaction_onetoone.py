import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("base", "0003_bankaccount_banktransaction"),
        ("budget", "0017_drop_transaction_is_paid"),
    ]

    operations = [
        migrations.AlterField(
            model_name="banktransaction",
            name="transaction",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bank_transaction",
                to="budget.transaction",
            ),
        ),
    ]
