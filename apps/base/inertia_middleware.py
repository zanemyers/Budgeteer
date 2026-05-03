from django.contrib.messages import get_messages

from inertia import share

from apps.base.models import Currency


class InertiaShareMiddleware:
    """Share auth and flash data with every Inertia response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            user = request.user
            currency_code = user.currency or "USD"
            try:
                currency = Currency.objects.get(code=currency_code)
                currency_symbol = currency.symbol
            except Currency.DoesNotExist:
                currency_symbol = "$"

            share(
                request,
                auth={
                    "user": {
                        "id": user.pk,
                        "email": user.email,
                        "name": user.get_full_name() or user.email,
                        "gravatar": user.avatar_url,
                        "is_staff": user.is_staff,
                        "currency_code": currency_code,
                        "currency_symbol": currency_symbol,
                    }
                },
            )

        response = self.get_response(request)

        # Forward Django messages as flash props on the *next* request via session,
        # but we can also attach them to the current response for redirects.
        flash_messages = [
            {"level": m.level_tag, "message": str(m)}
            for m in get_messages(request)
        ]
        if flash_messages:
            share(request, flash=flash_messages)

        return response
