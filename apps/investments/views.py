from collections import defaultdict

from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View

from inertia import render as inertia_render

from apps.banking.models import BankAccount
from apps.investments.data import aggregate_holdings, serialize_investment_account
from apps.investments.models import Holding


class InvestmentsView(LoginRequiredMixin, View):
    def get(self, request):
        holdings = list(
            Holding.objects.filter(bank_account__connection__user=request.user).select_related("bank_account")
        )

        # Group holdings by their account (loaded via select_related above, so no
        # extra query). Keyed by the BankAccount instance — model equality is by pk.
        by_account: dict[BankAccount, list[Holding]] = defaultdict(list)
        for h in holdings:
            by_account[h.bank_account].append(h)

        serialized_accounts = [
            serialize_investment_account(acct, acct_holdings)
            for acct, acct_holdings in sorted(by_account.items(), key=lambda kv: (kv[0].org_name, kv[0].name))
        ]

        return inertia_render(
            request,
            "Investments",
            {
                "accounts": serialized_accounts,
                "portfolio": aggregate_holdings(holdings),
            },
        )
