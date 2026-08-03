from django.core.management import call_command

from celery import shared_task


@shared_task
def generate_recurring_instances():
    call_command("generate_recurring_instances")
