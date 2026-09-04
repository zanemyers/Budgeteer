"""
Backfills `is_opening_balance` onto the goal opening balances already in the ledger.

They were written as ordinary income-typed transactions, which was invisible for as long as
`income_total` counted income landing in a goal category — the credit and the deduction cancelled.
Once goal deposits stopped counting as income (they were already counted when the paycheck they
came from arrived), the cancellation went with it and a 28,465.26 opening balance read as a
28,465.26 hole in the month it was recorded.

Identified by all three of: an income-typed line in a goal category, no payment method, and
"opening balance" in the description. A real deposit has a payment method and a description naming
the deposit, so no live row matches. The pattern is a one-time cleanup — new opening balances are
flagged at creation.
"""

from django.db import migrations


def flag_opening_balances(apps, schema_editor):
    Transaction = apps.get_model("budget", "Transaction")
    Transaction.objects.filter(
        transaction_type="income",
        payment_method__isnull=True,
        description__icontains="opening balance",
        lines__category__goal__isnull=False,
    ).distinct().update(is_opening_balance=True)


def unflag(apps, schema_editor):
    Transaction = apps.get_model("budget", "Transaction")
    Transaction.objects.filter(is_opening_balance=True).update(is_opening_balance=False)


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0005_transaction_is_opening_balance"),
    ]

    operations = [
        migrations.RunPython(flag_opening_balances, unflag),
    ]
