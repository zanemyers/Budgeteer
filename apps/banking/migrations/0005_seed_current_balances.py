from django.db import migrations
from django.utils import timezone


def seed_current_balances(apps, schema_editor):
    """
    Keep the one balance reading that still exists.

    Every earlier reading was already overwritten in place by a previous sync and cannot be
    recovered. The value sitting on BankAccount right now is real, though, and the next sync would
    replace it before the first snapshot was ever written — so it is captured here instead of
    starting the series from whenever the next cron run happens to land.

    `balance_as_of` is preferred for the timestamp since that is what the bridge reported the
    balance was true at; `updated_at` is the fallback for an account the bridge sent no
    balance-date for.
    """
    BankAccount = apps.get_model("banking", "BankAccount")
    BalanceSnapshot = apps.get_model("banking", "BalanceSnapshot")

    now = timezone.now()
    snapshots = [
        BalanceSnapshot(
            bank_account=account,
            balance=account.balance,
            available_balance=account.available_balance,
            as_of=account.balance_as_of or account.updated_at or now,
        )
        for account in BankAccount.objects.exclude(balance=None)
    ]
    BalanceSnapshot.objects.bulk_create(snapshots, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ("banking", "0004_balancesnapshot"),
    ]

    operations = [
        # Not reversed: by the time this could be rolled back, real syncs will have added
        # snapshots of their own, and there is nothing distinguishing the seeded rows from those.
        # Dropping the table is migration 0004's job.
        migrations.RunPython(seed_current_balances, migrations.RunPython.noop),
    ]
