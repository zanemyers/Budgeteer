import json
import urllib.request

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.base.management.commands.update_exchange_rates import CURRENCY_SYMBOLS
from apps.base.models import Currency


@shared_task
def update_exchange_rates():
    api_key = settings.EXCHANGERATE_API_KEY
    if not api_key:
        return "EXCHANGERATE_API_KEY is not set — skipping."

    base_url = f"https://v6.exchangerateapi.com/v6/{api_key}"

    with urllib.request.urlopen(f"{base_url}/codes", timeout=10) as resp:
        codes_data = json.loads(resp.read())

    if codes_data.get("result") != "success":
        raise RuntimeError(f"API error fetching codes: {codes_data}")

    with urllib.request.urlopen(f"{base_url}/latest/USD", timeout=10) as resp:
        rates_data = json.loads(resp.read())

    if rates_data.get("result") != "success":
        raise RuntimeError(f"API error fetching rates: {rates_data}")

    rates = rates_data["conversion_rates"]
    now = timezone.now()

    currencies = [
        Currency(
            code=code,
            name=name,
            symbol=CURRENCY_SYMBOLS.get(code, code),
            rate_to_usd=rates.get(code, 1),
            updated_at=now,
        )
        for code, name in codes_data["supported_codes"]
        if code in rates
    ]

    Currency.objects.bulk_create(
        currencies,
        update_conflicts=True,
        update_fields=["name", "symbol", "rate_to_usd", "updated_at"],
        unique_fields=["code"],
    )

    return f"Updated {len(currencies)} currencies."
