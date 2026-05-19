"""Remove banking models from the base app's state.

Pairs with `banking.0001_initial`, which adds them to the banking app's state
without touching the DB. The tables remain in Postgres with their original
`base_*` names.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("base", "0005_drop_last_sync_status"),
        ("banking", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.DeleteModel(name="BankTransaction"),
                migrations.DeleteModel(name="BankAccount"),
                migrations.DeleteModel(name="SimpleFINConnection"),
            ],
        ),
    ]
