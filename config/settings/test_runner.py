from ._base import *  # noqa: F403

# Run tests against a production-shaped stack. Without this, `_base` is imported with the
# developer's own DEBUG=on from .env, so the suite exercises a different middleware stack
# than production — and one that varies between developers.
DEBUG = False

# _base derives several settings from DEBUG at import time, so flipping DEBUG above is not
# enough — those values are already computed by the time this module runs. Undo the two that
# matter for tests.
#
# The toolbar app and middleware are appended to these lists under DEBUG.
INSTALLED_APPS = [app for app in INSTALLED_APPS if app != "debug_toolbar"]  # noqa: F405
MIDDLEWARE = [mw for mw in MIDDLEWARE if not mw.startswith("debug_toolbar.")]  # noqa: F405

# Transport security defaults to on when DEBUG is off. The test client speaks http, so
# leaving SECURE_SSL_REDIRECT on makes SecurityMiddleware 301 every request and every view
# test fails. This bites only where .env doesn't set DEBUG=on — i.e. in CI.
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

PASSWORD_HASHERS = ("django.contrib.auth.hashers.MD5PasswordHasher",)

AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.dummy.DummyCache",
    }
}

SESSION_ENGINE: str = "django.contrib.sessions.backends.cached_db"

# Keep tests off MinIO/S3. The default backend is S3, so without this any test that touches
# a FileField needs its own @override_settings.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

MAILERS = {"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}}

# Run queued tasks inline and surface their exceptions instead of needing a live worker.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
