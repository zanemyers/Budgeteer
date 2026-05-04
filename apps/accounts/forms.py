from django import forms
from django.contrib.auth import REDIRECT_FIELD_NAME

from allauth.account.forms import LoginForm
from allauth.utils import get_request_param


class SignInForm(LoginForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        redirect_field_value = get_request_param(self.request, REDIRECT_FIELD_NAME)
        if redirect_field_value:
            self.fields[REDIRECT_FIELD_NAME] = forms.Field(initial=redirect_field_value)
