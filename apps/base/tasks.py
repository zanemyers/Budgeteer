from celery import shared_task
from django.core.management import call_command


@shared_task
def update_exchange_rates():
    call_command("update_exchange_rates")
