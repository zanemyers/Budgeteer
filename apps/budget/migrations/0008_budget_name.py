from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0007_recurringtransaction_payment_method"),
    ]

    operations = [
        migrations.AddField(
            model_name="budget",
            name="name",
            field=models.CharField(blank=True, default="", max_length=150),
        ),
    ]
