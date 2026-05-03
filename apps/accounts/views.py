import json

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse
from django.shortcuts import redirect
from django.views import View

from allauth.account.models import EmailAddress
from allauth.account.views import (
    ConfirmEmailView as AllAuthConfirmEmailView,
    LoginView,
    PasswordResetDoneView as AllAuthPasswordResetDoneView,
    PasswordResetFromKeyDoneView as AllAuthPasswordResetFromKeyDoneView,
    PasswordResetFromKeyView as AllAuthPasswordResetFromKeyView,
    PasswordResetView as AllAuthPasswordResetView,
)
from inertia import render as inertia_render

from apps.accounts.forms import SignInForm


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class InertiaAllauthMixin:
    """Intercept allauth's render_to_response to return Inertia or JSON."""

    inertia_component: str

    def get_inertia_props(self, context: dict) -> dict:
        return {}

    def render_to_response(self, context, **kwargs):
        form = context.get("form")
        errors: dict = {}
        if form and hasattr(form, "errors"):
            errors = {k: v[0] if v else "" for k, v in form.errors.items()}

        props = {"errors": errors, **self.get_inertia_props(context)}

        if self.request.headers.get("X-Requested-With") == "XMLHttpRequest":  # type: ignore[attr-defined]
            return JsonResponse(props, status=422 if errors else 200)

        return inertia_render(self.request, self.inertia_component, props)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Auth views
# ---------------------------------------------------------------------------


class SignInView(InertiaAllauthMixin, LoginView):
    form_class = SignInForm
    inertia_component = "Login"

    def get_inertia_props(self, context: dict) -> dict:
        return {"next": self.request.GET.get("next") or self.request.POST.get("next") or ""}  # type: ignore[attr-defined]


class PasswordResetView(InertiaAllauthMixin, AllAuthPasswordResetView):
    inertia_component = "PasswordReset"

    def get_inertia_props(self, context: dict) -> dict:
        return {"done": False}


class PasswordResetDoneView(InertiaAllauthMixin, AllAuthPasswordResetDoneView):
    inertia_component = "PasswordReset"

    def render_to_response(self, context, **kwargs):
        return inertia_render(self.request, "PasswordReset", {"done": True, "errors": {}})  # type: ignore[attr-defined]


class PasswordResetFromKeyView(InertiaAllauthMixin, AllAuthPasswordResetFromKeyView):
    inertia_component = "PasswordResetConfirm"

    def get_inertia_props(self, context: dict) -> dict:
        return {"token_fail": context.get("token_fail", False), "done": False}


class PasswordResetFromKeyDoneView(InertiaAllauthMixin, AllAuthPasswordResetFromKeyDoneView):
    inertia_component = "PasswordResetConfirm"

    def render_to_response(self, context, **kwargs):
        return inertia_render(self.request, "PasswordResetConfirm", {"done": True, "token_fail": False, "errors": {}})  # type: ignore[attr-defined]


class ConfirmEmailView(InertiaAllauthMixin, AllAuthConfirmEmailView):
    inertia_component = "EmailConfirm"

    def get_success_url(self):
        return "/accounts/settings/"

    def get_inertia_props(self, context: dict) -> dict:
        confirmation = context.get("confirmation")
        return {
            "email": confirmation.email_address.email if confirmation else "",
            "invalid": confirmation is None,
        }


# ---------------------------------------------------------------------------
# Account settings
# ---------------------------------------------------------------------------


class AccountSettingsView(LoginRequiredMixin, View):
    def get(self, request):
        user = request.user
        email_addresses = list(
            EmailAddress.objects.filter(user=user).values("id", "email", "primary", "verified")
        )
        return inertia_render(request, "AccountSettings", {
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "email_addresses": email_addresses,
            "timezone": user.timezone,
            "avatar_url": user.avatar_url,
        })

    def patch(self, request):
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "Invalid JSON."}, status=400)
        action = data.get("action", "name")
        user = request.user

        if action == "resend_verification":
            email_str = data.get("email", "")
            try:
                ea = EmailAddress.objects.get(user=user, email=email_str)
                ea.send_confirmation(request)
                return JsonResponse({"ok": True})
            except EmailAddress.DoesNotExist:
                return JsonResponse({"error": "Email not found."}, status=404)

        if action == "make_primary":
            email_str = data.get("email", "")
            try:
                ea = EmailAddress.objects.get(user=user, email=email_str)
            except EmailAddress.DoesNotExist:
                return JsonResponse({"error": "Email not found."}, status=404)
            EmailAddress.objects.filter(user=user).update(primary=False)
            ea.primary = True
            ea.save(update_fields=["primary"])
            user.email = ea.email
            user.save(update_fields=["email"])
            addresses = list(EmailAddress.objects.filter(user=user).values("id", "email", "primary", "verified"))
            return JsonResponse({"email_addresses": addresses})

        if action == "remove_email":
            email_str = data.get("email", "")
            try:
                ea = EmailAddress.objects.get(user=user, email=email_str, primary=False)
            except EmailAddress.DoesNotExist:
                return JsonResponse({"error": "Cannot remove this email."}, status=400)
            ea.delete()
            return JsonResponse({"ok": True})

        if action == "update_timezone":
            tz = data.get("timezone", "").strip()
            if not tz:
                return JsonResponse({"error": "Timezone is required."}, status=400)
            user.timezone = tz
            user.save(update_fields=["timezone"])
            return JsonResponse({"timezone": user.timezone})

        # Default: update name
        user.first_name = data.get("first_name", user.first_name).strip()
        user.last_name = data.get("last_name", user.last_name).strip()
        user.save(update_fields=["first_name", "last_name"])
        return JsonResponse({"first_name": user.first_name, "last_name": user.last_name})

    def post(self, request):
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "Invalid JSON."}, status=400)
        action = data.get("action")

        if action == "add_email":
            user = request.user
            email_str = data.get("email", "").strip().lower()
            if not email_str:
                return JsonResponse({"error": "Email is required."}, status=400)
            if EmailAddress.objects.filter(email=email_str).exists():
                return JsonResponse({"error": "This email is already in use."}, status=400)
            ea = EmailAddress.objects.create(user=user, email=email_str, verified=False, primary=False)
            ea.send_confirmation(request)
            return JsonResponse({"id": ea.pk, "email": ea.email, "primary": False, "verified": False}, status=201)

        if action == "change_password":
            user = request.user
            old = data.get("old_password", "")
            new = data.get("new_password", "")
            confirm = data.get("confirm_password", "")
            if not user.check_password(old):
                return JsonResponse({"error": "Current password is incorrect."}, status=400)
            if len(new) < 8:
                return JsonResponse({"error": "New password must be at least 8 characters."}, status=400)
            if new != confirm:
                return JsonResponse({"error": "Passwords do not match."}, status=400)
            user.set_password(new)
            user.save()
            update_session_auth_hash(request, user)
            return JsonResponse({"ok": True})
        return JsonResponse({"error": "Unknown action."}, status=400)


class AvatarUploadView(LoginRequiredMixin, View):
    def post(self, request):
        from io import BytesIO

        from PIL import Image

        file = request.FILES.get("avatar")
        if not file:
            return JsonResponse({"error": "No file provided."}, status=400)
        if file.size > 5 * 1024 * 1024:
            return JsonResponse({"error": "File must be under 5 MB."}, status=400)
        try:
            img = Image.open(file)
            img.verify()
        except Exception:
            return JsonResponse({"error": "Invalid image file."}, status=400)

        file.seek(0)
        img = Image.open(file)
        img = img.convert("RGB")
        size = min(img.width, img.height)
        left = (img.width - size) // 2
        top = (img.height - size) // 2
        img = img.crop((left, top, left + size, top + size))
        img.thumbnail((256, 256), Image.LANCZOS)

        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)

        user = request.user
        from django.core.files.base import ContentFile
        user.avatar_thumbnail.save(f"{user.pk}_thumb.jpg", ContentFile(buf.read()), save=True)
        return JsonResponse({"avatar_url": user.avatar_url})
