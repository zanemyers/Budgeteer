from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_alter_user_groups_alter_user_is_active"),
        ("budget", "0009_paymentmethod_budget"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="default_budget",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="budget.budget",
            ),
        ),
    ]
