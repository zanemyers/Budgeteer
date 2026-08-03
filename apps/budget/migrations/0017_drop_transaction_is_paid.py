from django.db import migrations
from django.db.models import F


def backfill_paid_date(apps, schema_editor):
    """Where is_paid=True but paid_date is null, copy due_date into paid_date so we don't lose the 'paid' signal."""
    Transaction = apps.get_model("budget", "Transaction")
    Transaction.objects.filter(is_paid=True, paid_date__isnull=True).update(paid_date=F("due_date"))


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0016_backfill_recurring_lines"),
    ]

    operations = [
        migrations.RunPython(backfill_paid_date, noop_reverse),
        migrations.RemoveField(
            model_name="transaction",
            name="is_paid",
        ),
    ]
