import csv
from functools import cache
from pathlib import Path

import requests

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.base.models import Currency

CURRENCY_SYMBOLS_CSV = Path(__file__).resolve().parents[2] / "data" / "currency_symbols.csv"


@cache
def load_currency_symbols() -> dict[str, str]:
    """Load ISO-code → display-symbol mapping from CSV. Codes not listed fall back to the code itself."""
    with CURRENCY_SYMBOLS_CSV.open(encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header
        return {code: symbol for code, symbol in reader if code}


class Command(BaseCommand):
    help = "Fetch latest exchange rates from exchangerate-api.com and update the Currency table."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-stale",
            action="store_true",
            help="Only fetch if rates are older than 23 hours.",
        )

    def handle(self, *args, **options):
        api_key = settings.EXCHANGERATE_API_KEY
        if not api_key:
            self.stderr.write("EXCHANGERATE_API_KEY is not set — skipping.")
            return

        if options["if_stale"]:
            latest = Currency.objects.order_by("-updated_at").first()
            if latest and latest.updated_at:
                age = timezone.now() - latest.updated_at
                if age.total_seconds() < 23 * 3600:
                    self.stdout.write(f"Rates are fresh ({int(age.total_seconds() / 3600)}h old) — skipping.")
                    return

        base_url = f"https://v6.exchangerate-api.com/v6/{api_key}"

        self.stdout.write("Fetching supported currencies…")
        codes_data = requests.get(f"{base_url}/codes", timeout=10).json()
        if codes_data.get("result") != "success":
            self.stderr.write(f"API error: {codes_data}")
            return

        self.stdout.write("Fetching exchange rates…")
        rates_data = requests.get(f"{base_url}/latest/USD", timeout=10).json()
        if rates_data.get("result") != "success":
            self.stderr.write(f"API error: {rates_data}")
            return

        rates = rates_data["conversion_rates"]
        symbols = load_currency_symbols()
        now = timezone.now()

        currencies = [
            Currency(
                code=code,
                name=name,
                symbol=symbols.get(code, code),
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

        self.stdout.write(self.style.SUCCESS(f"Updated {len(currencies)} currencies."))
