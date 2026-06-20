from collections import defaultdict
from decimal import Decimal

from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View

from inertia import render as inertia_render

from apps.banking.models import BankAccount
from apps.investments.data import serialize_investment_account
from apps.investments.models import Holding


class InvestmentsView(LoginRequiredMixin, View):
    def get(self, request):
        user = request.user
        holdings = list(
            Holding.objects
            .filter(bank_account__connection__user=user)
            .select_related("bank_account")
        )

        by_account: dict[int, list[Holding]] = defaultdict(list)
        for h in holdings:
            by_account[h.bank_account_id].append(h)

        accounts = (
            BankAccount.objects
            .filter(pk__in=by_account.keys())
            .order_by("org_name", "name")
        )

        serialized_accounts = [
            serialize_investment_account(acct, by_account[acct.pk]) for acct in accounts
        ]

        portfolio_value = sum(
            (h.market_value for h in holdings if h.market_value is not None),
            Decimal("0"),
        )
        portfolio_cost = sum(
            (h.cost_basis for h in holdings if h.cost_basis is not None),
            Decimal("0"),
        )
        portfolio_gain = portfolio_value - portfolio_cost if portfolio_cost else None
        portfolio_gain_pct = (
            float((portfolio_gain / portfolio_cost) * 100)
            if (portfolio_gain is not None and portfolio_cost > 0)
            else None
        )

        return inertia_render(request, "Investments", {
            "accounts": serialized_accounts,
            "portfolio": {
                "market_value": str(portfolio_value),
                "cost_basis": str(portfolio_cost) if portfolio_cost else None,
                "unrealized_gain": str(portfolio_gain) if portfolio_gain is not None else None,
                "unrealized_gain_pct": portfolio_gain_pct,
            },
        })
