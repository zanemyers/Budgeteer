from django.contrib.messages import get_messages
from django.urls import NoReverseMatch, reverse

from inertia import share

from apps.base.models import Currency
from apps.investments.models import Holding


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
            currency = Currency.objects.filter(code=currency_code).first()
            currency_symbol = currency.symbol if currency else "$"

            sidebar_budget = _resolve_sidebar_budget(user)
            current_budget = (
                {"pk": sidebar_budget.pk, "name": sidebar_budget.name or str(sidebar_budget)}
                if sidebar_budget
                else None
            )

            has_investments = Holding.objects.filter(bank_account__connection__user=user).exists()

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
                has_investments=has_investments,
            )

        # Flash has to be shared *before* the response is built. Sharing afterwards cannot
        # affect an already-rendered response, and iterating get_messages() marks the storage
        # used — so MessageMiddleware (which runs its response phase after this one) then
        # discarded them. Between those two, server-side messages never reached the client.
        #
        # Read at request time, these are the messages set by whichever request redirected
        # here, which is how every messages.* call site in this project uses them.
        #
        # Not gated on authentication, so allauth's messages work on anonymous pages too.
        if not self._is_admin_path(request):
            flash_messages = [{"level": m.level_tag, "message": str(m)} for m in get_messages(request)]
            if flash_messages:
                share(request, flash=flash_messages)

        return self.get_response(request)

    @staticmethod
    def _is_admin_path(request) -> bool:
        """
        Report whether this is a Django admin URL, whose messages must be left alone.

        The admin renders messages through its own template, so consuming them here would
        show the user a blank confirmation after actions like the exchange-rate refresh.
        """
        try:
            admin_root = reverse("admin:index")
        except NoReverseMatch:
            return False
        return request.path.startswith(admin_root)
