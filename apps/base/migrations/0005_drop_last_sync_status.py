from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("base", "0004_banktransaction_onetoone"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="simplefinconnection",
            name="last_sync_status",
        ),
    ]
