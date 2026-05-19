from django.db import migrations


def backfill_lines(apps, schema_editor):
    """Add a TransactionLine to every recurring Transaction that has none."""
    Transaction = apps.get_model("budget", "Transaction")
    TransactionLine = apps.get_model("budget", "TransactionLine")
    qs = Transaction.objects.filter(recurring__isnull=False, lines__isnull=True).select_related("recurring")
    lines = []
    for txn in qs.iterator():
        rt = txn.recurring
        lines.append(
            TransactionLine(
                transaction=txn,
                category_id=rt.category_id,
                amount=rt.amount,
                amount_usd=rt.amount,
            )
        )
        if len(lines) >= 500:
            TransactionLine.objects.bulk_create(lines)
            lines = []
    if lines:
        TransactionLine.objects.bulk_create(lines)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("budget", "0015_add_direct_deposit_payment_type"),
    ]

    operations = [
        migrations.RunPython(backfill_lines, noop_reverse),
    ]
