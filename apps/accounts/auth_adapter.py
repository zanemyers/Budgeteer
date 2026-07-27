from django.conf import settings

from allauth.account.adapter import DefaultAccountAdapter


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request):
        return getattr(settings, "ACCOUNT_SIGNUP_OPEN", True)

    def is_ajax(self, request):
        if request.headers.get("X-Inertia"):
            return False
        return super().is_ajax(request)

    def add_message(self, request, level, message_template=None, message_context=None, extra_tags="", message=None):
        if message_template == "account/messages/logged_in.txt":
            return
        super().add_message(request, level, message_template, message_context, extra_tags, message)
