from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("budget", "0010_category_sinking_fund"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="transaction_type",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
    ]
