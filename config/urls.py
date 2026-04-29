from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, include, path

from apps.accounts.views import (
    AccountSettingsView,
    ConfirmEmailView,
    PasswordResetDoneView,
    PasswordResetFromKeyDoneView,
    PasswordResetFromKeyView,
    PasswordResetView,
    SignInView,
)
from apps.base.views import http_404, http_500
from apps.budget.views import BudgetHistoryView, BudgetHomeView

# Includes
urlpatterns: list[URLResolver | URLPattern] = [path(r"admin/", admin.site.urls)]

# Project Urls
urlpatterns += [
    path("", BudgetHomeView.as_view(), name="site_index"),
    path("-/", include("django_alive.urls")),
    path("500/", http_500),
    path("404/", http_404),
    path("accounts/history/", BudgetHistoryView.as_view(), name="budget_history"),
    path("accounts/settings/", AccountSettingsView.as_view(), name="account_settings"),
    path("accounts/name/", AccountSettingsView.as_view(), name="account_change_name"),
    # Override allauth URLs with Inertia versions (must come before allauth.urls)
    path("accounts/login/", SignInView.as_view(), name="account_login"),
    path("accounts/password/reset/", PasswordResetView.as_view(), name="account_reset_password"),
    path("accounts/password/reset/done/", PasswordResetDoneView.as_view(), name="account_reset_password_done"),
    path("accounts/password/reset/key/<uidb36>-<key>/", PasswordResetFromKeyView.as_view(), name="account_reset_password_from_key"),
    path("accounts/password/reset/key/done/", PasswordResetFromKeyDoneView.as_view(), name="account_reset_password_from_key_done"),
    path("accounts/confirm-email/<key>/", ConfirmEmailView.as_view(), name="account_confirm_email"),
    path("accounts/", include("allauth.urls")),
    path("budgets/", include("apps.budget.urls", namespace="budget")),
]

# Debug/Development URLs
if settings.DEBUG is True:
    import debug_toolbar

    urlpatterns += [
        path("__debug__/", include(debug_toolbar.urls)),
        path("admin/doc/", include("django.contrib.admindocs.urls")),
    ]
