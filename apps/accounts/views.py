from io import BytesIO
from zoneinfo import available_timezones

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import ensure_csrf_cookie

from allauth.account.forms import ChangePasswordForm
from allauth.account.models import EmailAddress
from allauth.account.views import (
    ConfirmEmailView as AllAuthConfirmEmailView,
    LoginView,
    PasswordResetDoneView as AllAuthPasswordResetDoneView,
    PasswordResetFromKeyDoneView as AllAuthPasswordResetFromKeyDoneView,
    PasswordResetFromKeyView as AllAuthPasswordResetFromKeyView,
    PasswordResetView as AllAuthPasswordResetView,
    SignupView,
)
from allauth.core import ratelimit
from inertia import render as inertia_render
from PIL import Image, ImageOps

from apps.banking.models import SimpleFINConnection
from apps.banking.simplefin import SimpleFINError, claim_setup_token
from apps.base.http import parse_json_body
from apps.base.models import Currency


class InertiaAllauthMixin:
    """
    Intercept allauth's render_to_response to return Inertia or JSON.

    Comes first in every subclass's MRO, so wrapping dispatch here seeds the csrftoken
    cookie on every auth page — the SPA reads it to set X-CSRFToken on its POST, and
    Django only sets the cookie on demand.
    """

    inertia_component: str
    inertia_props: dict = {}

    @method_decorator(ensure_csrf_cookie)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)  # type: ignore[misc]

    def get_inertia_props(self, context: dict) -> dict:
        return self.inertia_props

    def render_to_response(self, context: dict) -> JsonResponse:
        form = context.get("form")
        errors: dict = {}
        if form and hasattr(form, "errors"):
            errors = {k: v[0] if v else "" for k, v in form.errors.items()}

        props = {"errors": errors, **self.get_inertia_props(context)}

        # Only our form-submit fetches get the JSON error shape. Inertia SPA navigations also set
        # X-Requested-With, but they must get an Inertia response or the client throws.
        headers = self.request.headers  # type: ignore[attr-defined]
        if headers.get("X-Requested-With") == "XMLHttpRequest" and not headers.get("X-Inertia"):
            return JsonResponse(props, status=422 if errors else 200)
        return inertia_render(self.request, self.inertia_component, props)  # type: ignore[attr-defined]


# --- Auth views ---


class NextPropMixin(InertiaAllauthMixin):
    """Pass ?next= through to the SPA so it can resume where the user was headed."""

    def get_inertia_props(self, context: dict) -> dict:
        return {"next": self.request.GET.get("next") or self.request.POST.get("next") or ""}  # type: ignore[attr-defined]


class SignInView(NextPropMixin, LoginView):
    inertia_component = "Login"


class SignUpView(NextPropMixin, SignupView):
    inertia_component = "Signup"


class PasswordResetView(InertiaAllauthMixin, AllAuthPasswordResetView):
    inertia_component = "PasswordReset"
    inertia_props = {"done": False}


class PasswordResetDoneView(InertiaAllauthMixin, AllAuthPasswordResetDoneView):
    inertia_component = "PasswordReset"
    inertia_props = {"done": True}


class PasswordResetFromKeyView(InertiaAllauthMixin, AllAuthPasswordResetFromKeyView):
    inertia_component = "PasswordResetConfirm"

    def get_inertia_props(self, context: dict) -> dict:
        return {"token_fail": context.get("token_fail", False), "done": False}


class PasswordResetFromKeyDoneView(InertiaAllauthMixin, AllAuthPasswordResetFromKeyDoneView):
    inertia_component = "PasswordResetConfirm"
    inertia_props = {"done": True, "token_fail": False}


class ConfirmEmailView(InertiaAllauthMixin, AllAuthConfirmEmailView):
    inertia_component = "EmailConfirm"

    def get_success_url(self):
        return "/accounts/settings/"

    def get_inertia_props(self, context: dict) -> dict:
        confirmation = context.get("confirmation")
        return {
            "email": getattr(getattr(confirmation, "email_address", None), "email", ""),
            "invalid": confirmation is None,
        }


# --- Account settings ---


def _email_addresses(user) -> list[dict]:
    """Build the email list shape the settings page and its PATCH responses both return."""
    return list(EmailAddress.objects.filter(user=user).values())


def _serialize_simplefin_connection(conn: SimpleFINConnection) -> dict:
    return {
        "id": conn.pk,
        "label": conn.label,
        "last_synced_at": conn.last_synced_at.isoformat() if conn.last_synced_at else None,
        "last_sync_status": conn.sync_status,
        "created_at": conn.created_at.isoformat(),
    }


class AccountSettingsView(LoginRequiredMixin, View):
    def get(self, request):
        user = request.user

        return inertia_render(
            request,
            "AccountSettings",
            {
                "first_name": user.first_name,
                "last_name": user.last_name,
                "email_addresses": _email_addresses(user),
                "timezone": user.timezone,
                "avatar_url": user.avatar_url,
                "currency": user.currency,
                "currencies": list(Currency.objects.values().order_by("code")),
                "simplefin_connections": [
                    _serialize_simplefin_connection(c) for c in SimpleFINConnection.objects.filter(user=user)
                ],
            },
        )

    def patch(self, request):
        data = parse_json_body(request)
        action = data.get("action")
        user = request.user

        if action == "resend_verification":
            email_str = data.get("email", "")
            # We bypass allauth's confirm-email view, so apply its 1/180s-per-email limit ourselves.
            if not ratelimit.consume(request, action="confirm_email", key=email_str.lower()):
                return JsonResponse(
                    {"error": "Please wait a moment before requesting another verification email."},
                    status=429,
                )
            ea = EmailAddress.objects.filter(user=user, email=email_str).first()
            if not ea:
                return JsonResponse({"error": "Email not found."}, status=404)
            ea.send_confirmation(request)
            return JsonResponse({"ok": True})

        if action == "make_primary":
            ea = EmailAddress.objects.filter(user=user, email=data.get("email", "")).first()
            if not ea:
                return JsonResponse({"error": "Email not found."}, status=404)
            # set_as_primary() also rewrites user.email, which is the login identity — so an
            # unverified address here would move the account to a mailbox nobody has proven
            # they own, sending future password resets there.
            if not ea.verified:
                return JsonResponse({"error": "Verify this email before making it primary."}, status=400)
            ea.set_as_primary()
            return JsonResponse({"email_addresses": _email_addresses(user)})

        if action == "remove_simplefin_connection":
            deleted, _ = SimpleFINConnection.objects.filter(user=user, pk=data.get("id")).delete()
            if not deleted:
                return JsonResponse({"error": "Connection not found."}, status=404)
            return JsonResponse({"ok": True})

        if action == "remove_email":
            # primary=False alone isn't enough: a user whose only address was never flagged
            # primary could delete it and end up with no address at all.
            if EmailAddress.objects.filter(user=user).count() <= 1:
                return JsonResponse({"error": "You need at least one email address."}, status=400)
            deleted, _ = EmailAddress.objects.filter(user=user, email=data.get("email", ""), primary=False).delete()
            if not deleted:
                return JsonResponse({"error": "Cannot remove this email."}, status=400)
            return JsonResponse({"ok": True})

        if action == "update_timezone":
            tz = data.get("timezone", "").strip()
            if tz not in available_timezones():
                return JsonResponse({"error": "Invalid timezone."}, status=400)
            user.timezone = tz
            user.save(update_fields=["timezone"])
            return JsonResponse({"timezone": tz})

        if action == "update_currency":
            code = data.get("currency", "").strip().upper()
            currency = Currency.objects.filter(code=code).first()
            if not currency:
                return JsonResponse({"error": "Invalid currency code."}, status=400)
            user.currency = code
            user.save(update_fields=["currency"])
            return JsonResponse({"currency": code, "currency_symbol": currency.symbol})

        if action == "update_name":
            user.first_name = (data.get("first_name") or user.first_name).strip()
            user.last_name = (data.get("last_name") or user.last_name).strip()
            user.save(update_fields=["first_name", "last_name"])
            return JsonResponse({"first_name": user.first_name, "last_name": user.last_name})

        return JsonResponse({"error": "Unknown action."}, status=400)

    def post(self, request):
        data = parse_json_body(request)
        action = data.get("action")
        user = request.user

        if action == "add_email":
            email_str = (data.get("email") or "").strip().lower()
            if not email_str:
                return JsonResponse({"error": "Email is required."}, status=400)
            if EmailAddress.objects.filter(email=email_str).exists():
                return JsonResponse({"error": "This email is already in use."}, status=400)
            ea = EmailAddress.objects.add_email(request, user, email_str, confirm=True)
            return JsonResponse(
                {"id": ea.pk, "email": ea.email, "primary": ea.primary, "verified": ea.verified},
                status=201,
            )

        if action == "claim_simplefin_token":
            try:
                access_url = claim_setup_token(data.get("setup_token", ""))
            except SimpleFINError as e:
                return JsonResponse({"error": str(e)}, status=400)
            conn = SimpleFINConnection.objects.create(
                user=user,
                label=(data.get("label") or "").strip()[:100],
                access_url=access_url,
            )
            return JsonResponse(_serialize_simplefin_connection(conn), status=201)

        if action == "change_password":
            form = ChangePasswordForm(
                user=user,
                data={
                    "oldpassword": data.get("old_password", ""),
                    "password1": data.get("new_password", ""),
                    "password2": data.get("confirm_password", ""),
                },
            )
            if not form.is_valid():
                return JsonResponse({"error": next(iter(form.errors.values()))[0]}, status=400)
            form.save()
            update_session_auth_hash(request, user)
            return JsonResponse({"ok": True})

        return JsonResponse({"error": "Unknown action."}, status=400)


class AvatarUploadView(LoginRequiredMixin, View):
    def post(self, request):
        file = request.FILES.get("avatar")
        if not file:
            return JsonResponse({"error": "No file provided."}, status=400)
        if file.size > 5 * 1024 * 1024:
            return JsonResponse({"error": "File must be under 5 MB."}, status=400)
        try:
            img = ImageOps.fit(Image.open(file).convert("RGB"), (256, 256), Image.Resampling.LANCZOS)
        except Image.DecompressionBombError:
            # Not an OSError, so it needs its own arm — and it fires on honest huge scans, not
            # just crafted files, which is why it gets a message about size rather than validity.
            return JsonResponse({"error": "Image dimensions are too large."}, status=400)
        except OSError:
            return JsonResponse({"error": "Invalid image file."}, status=400)

        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)

        user = request.user
        user.avatar_thumbnail.save(f"{user.pk}_thumb.jpg", ContentFile(buf.getvalue()))
        return JsonResponse({"avatar_url": user.avatar_url})
