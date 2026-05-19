from celery import shared_task
from django.core.management import call_command


@shared_task
def sync_simplefin(connection_id: int | None = None):
    if connection_id is not None:
        call_command("sync_simplefin", connection=connection_id)
    else:
        call_command("sync_simplefin")
