from django.db import migrations


def backfill_last_success_at(apps, schema_editor):
    """
    Seed last_success_at from the attempts we can prove succeeded.

    A connection whose last attempt left no error succeeded, so last_synced_at is also its last
    success. One that is currently carrying an error tells us nothing about when it last worked, so
    it stays null — and sync_status treats a null as "no recent success", which is the safe reading:
    a connection that has been failing since before this migration should show as needing attention
    rather than being granted a grace period it has not earned.
    """
    SimpleFINConnection = apps.get_model("banking", "SimpleFINConnection")
    for connection in SimpleFINConnection.objects.filter(last_sync_error="", last_synced_at__isnull=False):
        connection.last_success_at = connection.last_synced_at
        connection.save(update_fields=["last_success_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("banking", "0006_simplefinconnection_last_success_at_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_last_success_at, migrations.RunPython.noop),
    ]
