import csv
from functools import cache
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

import requests

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

    def _get_json(self, url: str) -> dict:
        """
        GET a URL and parse JSON, converting failures into CommandError.

        Unwrapped, a network blip or an HTML error page raised out of handle() as a raw
        traceback in the cron log with a zero-ish signal and no indication of which call
        failed. The API key is in the URL, so the URL is never included in the message.
        """
        try:
            response = requests.get(url, timeout=10)
        except requests.RequestException as e:
            raise CommandError(f"Could not reach the exchange rate API: {e.__class__.__name__}") from e
        if response.status_code != 200:
            raise CommandError(f"Exchange rate API returned HTTP {response.status_code}.")
        try:
            return response.json()
        except ValueError as e:
            raise CommandError("Exchange rate API returned a non-JSON response.") from e

    def handle(self, *args, **options):
        api_key = settings.EXCHANGERATE_API_KEY
        if not api_key:
            # Not fatal — a single-currency install never needs this. But the consequence is
            # invisible otherwise: every Currency.rate_to_usd stays at its default of 1, so
            # any non-USD amount is silently converted at par.
            self.stderr.write(
                self.style.WARNING(
                    "EXCHANGERATE_API_KEY is not set — skipping. Exchange rates will stay at 1.0, "
                    "so amounts in any currency other than USD will be wrong until it is configured."
                )
            )
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
        codes_data = self._get_json(f"{base_url}/codes")
        if codes_data.get("result") != "success":
            raise CommandError(f"Exchange rate API returned an error for /codes: {codes_data}")

        self.stdout.write("Fetching exchange rates…")
        rates_data = self._get_json(f"{base_url}/latest/USD")
        if rates_data.get("result") != "success":
            raise CommandError(f"Exchange rate API returned an error for /latest/USD: {rates_data}")

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
