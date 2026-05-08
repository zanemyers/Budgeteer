from django.contrib.messages import get_messages

from inertia import share

from apps.base.models import Currency


def _resolve_sidebar_budget(user):
    """Pick the budget to surface in the sidebar: last viewed → default → first membership."""
    from apps.budget.models import Budget

    member_pks = set(Budget.objects.filter(members=user).values_list("pk", flat=True))
    if not member_pks:
        return None

    for candidate_id in (user.last_viewed_budget_id, user.default_budget_id):
        if candidate_id in member_pks:
            return Budget.objects.get(pk=candidate_id)
    return Budget.objects.filter(pk__in=member_pks).first()


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

            sidebar_budget = _resolve_sidebar_budget(user)
            current_budget = (
                {"pk": sidebar_budget.pk, "name": sidebar_budget.name or str(sidebar_budget)}
                if sidebar_budget
                else None
            )

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
                        "currency_rate": str(currency.rate_to_usd) if currency else "1",
                    }
                },
                current_budget=current_budget,
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
