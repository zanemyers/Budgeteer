from django.core.management import call_command

from celery import shared_task


@shared_task
def sync_simplefin(connection_id: int | None = None):
    # A None connection_id syncs every connection — the command treats it as "all".
    call_command("sync_simplefin", connection=connection_id)
