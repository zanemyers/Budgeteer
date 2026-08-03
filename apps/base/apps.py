from django.apps import AppConfig


class BaseConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.base"

    def ready(self):
        """
        Unregister noise admin entries.

        Runs in INSTALLED_APPS order, AFTER django.contrib.admin's autodiscover
        has already imported every app's admin.py — so allauth has registered
        EmailAddress by now and we can actually unregister it.
        """
        import contextlib

        from django.contrib import admin
        from django.contrib.auth.models import Group
        from django.contrib.sites.models import Site

        from allauth.account.models import EmailAddress

        for model in (Group, Site, EmailAddress):
            with contextlib.suppress(admin.sites.NotRegistered):
                admin.site.unregister(model)
