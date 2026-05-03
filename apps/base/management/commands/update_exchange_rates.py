import requests

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.base.models import Currency

# Symbol overrides for common currencies — fallback to code for anything not listed.
CURRENCY_SYMBOLS = {
    "AED": "د.إ", "AFN": "؋", "ALL": "L", "AMD": "֏", "ANG": "ƒ", "AOA": "Kz",
    "ARS": "$", "AUD": "A$", "AWG": "ƒ", "AZN": "₼", "BAM": "KM", "BBD": "$",
    "BDT": "৳", "BGN": "лв", "BHD": ".د.ب", "BIF": "Fr", "BMD": "$", "BND": "$",
    "BOB": "Bs.", "BRL": "R$", "BSD": "$", "BTN": "Nu", "BWP": "P", "BYN": "Br",
    "BZD": "$", "CAD": "CA$", "CDF": "Fr", "CHF": "Fr", "CLP": "$", "CNY": "¥",
    "COP": "$", "CRC": "₡", "CUP": "$", "CVE": "$", "CZK": "Kč", "DJF": "Fr",
    "DKK": "kr", "DOP": "$", "DZD": "دج", "EGP": "£", "ERN": "Nfk", "ETB": "Br",
    "EUR": "€", "FJD": "$", "FKP": "£", "FOK": "kr", "GBP": "£", "GEL": "₾",
    "GGP": "£", "GHS": "₵", "GIP": "£", "GMD": "D", "GNF": "Fr", "GTQ": "Q",
    "GYD": "$", "HKD": "HK$", "HNL": "L", "HRK": "kn", "HTG": "G", "HUF": "Ft",
    "IDR": "Rp", "ILS": "₪", "IMP": "£", "INR": "₹", "IQD": "ع.د", "IRR": "﷼",
    "ISK": "kr", "JEP": "£", "JMD": "$", "JOD": "د.ا", "JPY": "¥", "KES": "KSh",
    "KGS": "лв", "KHR": "៛", "KID": "$", "KMF": "Fr", "KRW": "₩", "KWD": "د.ك",
    "KYD": "$", "KZT": "₸", "LAK": "₭", "LBP": "£", "LKR": "₨", "LRD": "$",
    "LSL": "L", "LYD": "ل.د", "MAD": "MAD", "MDL": "L", "MGA": "Ar", "MKD": "ден",
    "MMK": "K", "MNT": "₮", "MOP": "P", "MRU": "UM", "MUR": "₨", "MVR": "Rf",
    "MWK": "MK", "MXN": "$", "MYR": "RM", "MZN": "MT", "NAD": "$", "NGN": "₦",
    "NIO": "C$", "NOK": "kr", "NPR": "₨", "NZD": "NZ$", "OMR": "﷼", "PAB": "B/.",
    "PEN": "S/", "PGK": "K", "PHP": "₱", "PKR": "₨", "PLN": "zł", "PYG": "₲",
    "QAR": "﷼", "RON": "lei", "RSD": "din", "RUB": "₽", "RWF": "Fr", "SAR": "﷼",
    "SBD": "$", "SCR": "₨", "SDG": "£", "SEK": "kr", "SGD": "S$", "SHP": "£",
    "SLE": "Le", "SLL": "Le", "SOS": "Sh", "SRD": "$", "STN": "Db", "SYP": "£",
    "SZL": "L", "THB": "฿", "TJS": "SM", "TMT": "T", "TND": "د.ت", "TOP": "T$",
    "TRY": "₺", "TTD": "$", "TVD": "$", "TWD": "NT$", "TZS": "Sh", "UAH": "₴",
    "UGX": "Sh", "USD": "$", "UYU": "$", "UZS": "лв", "VES": "Bs.S", "VND": "₫",
    "VUV": "Vt", "WST": "T", "XAF": "Fr", "XCD": "$", "XDR": "SDR", "XOF": "Fr",
    "XPF": "Fr", "YER": "﷼", "ZAR": "R", "ZMW": "ZK", "ZWL": "$",
}


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

        self.stdout.write(self.style.SUCCESS(f"Updated {len(currencies)} currencies."))
