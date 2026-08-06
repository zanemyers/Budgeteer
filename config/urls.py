from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import URLPattern, URLResolver, include, path

from apps.accounts.views import (
    AccountSettingsView,
    AvatarUploadView,
    ConfirmEmailView,
    PasswordResetDoneView,
    PasswordResetFromKeyDoneView,
    PasswordResetFromKeyView,
    PasswordResetView,
    SignInView,
    SignUpView,
)
from apps.banking.views import BankAccountUpdateView, BankingView, banking_sync
from apps.base.views import http_404, http_500, refresh_exchange_rates
from apps.budget.views import BudgetHistoryView, OnboardingView, SiteIndexView
from apps.investments.views import InvestmentsView

# Includes
urlpatterns: list[URLResolver | URLPattern] = [
    path("admin/refresh-exchange-rates/", refresh_exchange_rates, name="admin_refresh_exchange_rates"),
    path(r"admin/", admin.site.urls),
]

# Project Urls
urlpatterns += [
    path("", SiteIndexView.as_view(), name="site_index"),
    path("onboarding/", OnboardingView.as_view(), name="onboarding"),
    path("-/", include("django_alive.urls")),
    path("accounts/history/", BudgetHistoryView.as_view(), name="budget_history"),
    path("accounts/settings/", AccountSettingsView.as_view(), name="account_settings"),
    path("accounts/avatar/", AvatarUploadView.as_view(), name="account_avatar"),
    # Override allauth URLs with Inertia versions (must come before allauth.urls)
    path("accounts/login/", SignInView.as_view(), name="account_login"),
    path("accounts/signup/", SignUpView.as_view(), name="account_signup"),
    path("accounts/password/reset/", PasswordResetView.as_view(), name="account_reset_password"),
    path("accounts/password/reset/done/", PasswordResetDoneView.as_view(), name="account_reset_password_done"),
    path(
        "accounts/password/reset/key/<uidb36>-<key>/",
        PasswordResetFromKeyView.as_view(),
        name="account_reset_password_from_key",
    ),
    path(
        "accounts/password/reset/key/done/",
        PasswordResetFromKeyDoneView.as_view(),
        name="account_reset_password_from_key_done",
    ),
    path("accounts/confirm-email/<key>/", ConfirmEmailView.as_view(), name="account_confirm_email"),
    path("accounts/", include("allauth.urls")),
    path("banking/", BankingView.as_view(), name="banking"),
    path("banking/sync/", banking_sync, name="banking_sync"),
    path("banking/accounts/<int:pk>/", BankAccountUpdateView.as_view(), name="banking_account"),
    path("investments/", InvestmentsView.as_view(), name="investments"),
    path("budgets/", include("apps.budget.urls", namespace="budget")),
]

# Debug/Development URLs
if settings.DEBUG is True:
    import debug_toolbar

    urlpatterns += [
        path("__debug__/", include(debug_toolbar.urls)),
        path("admin/doc/", include("django.contrib.admindocs.urls")),
        # Error-page previews. Kept behind DEBUG so they aren't a public exception trigger.
        path("500/", http_500),
        path("404/", http_404),
    ]

# Serve user-uploaded media in development only, and only when both settings are real.
# A blank MEDIA_URL resolves to "/", which would make this a catch-all that serves every
# file in the project root (.env included) and shadows the custom 404 handler.
if settings.DEBUG and settings.MEDIA_ROOT and settings.MEDIA_URL not in ("", "/"):
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
