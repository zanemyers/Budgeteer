"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/6.0/ref/settings/
"""

import contextlib
import socket
from pathlib import Path

from epicenv import Env

env = Env()

BASE_DIR = Path(__file__).resolve().parent.parent.parent

READ_DOT_ENV_FILE = env.bool("READ_DOT_ENV_FILE", default=True)

if READ_DOT_ENV_FILE is True:
    env.read_env(str(BASE_DIR.joinpath(".env")))

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env("SECRET_KEY")

# Fernet key for encrypting at-rest secrets (SimpleFIN access URLs, etc.).
# Rotating invalidates existing encrypted rows.
FERNET_KEY = env("FERNET_KEY")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool("DEBUG", default=False)

INSTANCE = env("INSTANCE", default="dev")

ALLOWED_HOSTS: list[str] = env.list("ALLOWED_HOSTS", default=[])
INTERNAL_IPS = env.list("INTERNAL_IPS", default=["127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# Transport security. All of this is off under DEBUG so local http:// development works.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=not DEBUG)

# Only set when a reverse proxy actually terminates TLS *and* strips a client-supplied
# X-Forwarded-Proto. Trusting this header unconditionally lets a client claim HTTPS.
if env.bool("BEHIND_TLS_PROXY", default=False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Starts at one hour rather than a year: a misconfigured HSTS header is not
# recoverable for visitors who already cached it, so raise this deliberately.
SECURE_HSTS_SECONDS = 0 if DEBUG else env.int("SECURE_HSTS_SECONDS", default=3600)
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = False

# Get the IP to use for Django Debug Toolbar when developing with docker
if env.bool("USE_DOCKER", default=False) is True:
    ip = socket.gethostbyname(socket.gethostname())
    INTERNAL_IPS += [ip[:-1] + "1"]

# Application definition

INSTALLED_APPS = [
    # Unfold and its contrib apps must come before django.contrib.admin
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.sites",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "django_vite",
    "apps.base",
    "apps.accounts",
    "apps.budget",
    "apps.banking",
    "apps.investments",
    "inertia",
    "maintenance_mode",
    "allauth",
    "allauth.account",
    "storages",
]

MIDDLEWARE = [
    "allauth.account.middleware.AccountMiddleware",
    "django_alive.middleware.healthcheck_bypass_host_check",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "inertia.middleware.InertiaMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "apps.base.inertia_middleware.InertiaShareMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "maintenance_mode.middleware.MaintenanceModeMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "maintenance_mode.context_processors.maintenance_mode",
                "apps.base.context_processors.site_name",
            ],
        },
    },
]

WSGI_APPLICATION = env("WSGI_APPLICATION", default="config.wsgi.application")
DB_SSL_REQUIRED = env.bool("DB_SSL_REQUIRED", default=not DEBUG)

# Database
# See https://github.com/jacobian/dj-database-url for more examples
DATABASES = {
    "default": env.dj_db_url(
        "DATABASE_URL", default="postgres://postgres@postgres/postgres", ssl_require=DB_SSL_REQUIRED
    )
}

# Custom User Model
# https://docs.djangoproject.com/en/6.0/topics/auth/customizing/#substituting-a-custom-user-model
AUTH_USER_MODEL = "accounts.User"

# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "America/Chicago"

USE_I18N = True


USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATICFILES_FINDERS = (
    "django.contrib.staticfiles.finders.FileSystemFinder",
    "django.contrib.staticfiles.finders.AppDirectoriesFinder",
)

DEFAULT_FILE_STORAGE_BACKEND = env("DEFAULT_FILE_STORAGE", default="storages.backends.s3boto3.S3Boto3Storage")

STORAGES = {
    "default": {
        "BACKEND": DEFAULT_FILE_STORAGE_BACKEND,
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# AWS Credentials: Required when using MediaS3Storage or when using Django SES for email in non-prod instances
AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", default="")
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default="")

# Media S3 storage settings (used for both MinIO local dev and real S3 in prod).
MEDIA_S3_ACCESS_KEY = env("MEDIA_S3_ACCESS_KEY", default="")
MEDIA_S3_SECRET_KEY = env("MEDIA_S3_SECRET_KEY", default="")
MEDIA_S3_ENDPOINT_URL = env("MEDIA_S3_ENDPOINT_URL", default="")
MEDIA_S3_URL_ENDPOINT_URL = env("MEDIA_S3_URL_ENDPOINT_URL", default="")
MEDIA_S3_BUCKET_NAME = env("MEDIA_S3_BUCKET_NAME", default="")

PUBLIC_ROOT = BASE_DIR.joinpath("public")
STATIC_ROOT = BASE_DIR.joinpath("collected_static")
STATICFILES_DIRS = [str(PUBLIC_ROOT.joinpath("static"))]

if "s3boto3" in DEFAULT_FILE_STORAGE_BACKEND.lower():
    # MinIO locally, real S3 in prod. URL generation comes from the storage backend.
    STORAGES["default"]["OPTIONS"] = {
        "access_key": MEDIA_S3_ACCESS_KEY,
        "secret_key": MEDIA_S3_SECRET_KEY,
        "bucket_name": MEDIA_S3_BUCKET_NAME,
        "default_acl": "private",
        "querystring_auth": True,
        "file_overwrite": False,
    }
    if MEDIA_S3_ENDPOINT_URL:
        STORAGES["default"]["OPTIONS"]["endpoint_url"] = MEDIA_S3_ENDPOINT_URL
    if MEDIA_S3_URL_ENDPOINT_URL:
        STORAGES["default"]["BACKEND"] = "apps.base.storage.S3MediaStorage"
        STORAGES["default"]["OPTIONS"]["url_endpoint_url"] = MEDIA_S3_URL_ENDPOINT_URL
    STATIC_URL = "/public/static/"
    # Media is served by the storage backend, not Django, so these are only here to keep
    # MEDIA_URL/MEDIA_ROOT from defaulting to "" — an empty MEDIA_URL resolves to "/" and
    # turns the static() helper in config/urls.py into a catch-all that serves the repo root.
    MEDIA_ROOT = PUBLIC_ROOT.joinpath("media")
    MEDIA_URL = "/public/media/"

elif DEFAULT_FILE_STORAGE_BACKEND.endswith("MediaS3Storage"):
    STORAGES["staticfiles"]["BACKEND"] = env("STATICFILES_STORAGE")
    AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME")
    AWS_DEFAULT_ACL = "public-read"
    AWS_S3_REGION = env("AWS_S3_REGION", default="us-east-2")
    AWS_S3_CUSTOM_DOMAIN = f"s3.{AWS_S3_REGION}.amazonaws.com/{AWS_STORAGE_BUCKET_NAME}"
    AWS_S3_OBJECT_PARAMETERS = {"CacheControl": "max-age=86400"}
    STATIC_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/static/"
    MEDIA_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/media/"

else:
    # Local filesystem storage fallback.
    MEDIA_ROOT = PUBLIC_ROOT.joinpath("media")
    MEDIA_URL = "/public/media/"
    STATIC_URL = "/public/static/"

EXCHANGERATE_API_KEY = env("EXCHANGERATE_API_KEY", default="")

# How far ahead the nightly job materializes recurring bills and expected paychecks.
# Deliberately days, not months: a schedule only becomes a real Transaction shortly before
# it's due, so the register shows what's actually imminent instead of a month of rows on the
# 1st that can't be reconciled until the end of it. Widening this is safe; narrowing it
# leaves already-generated instances behind, so follow it with
# `generate_recurring_instances --prune`.
BUDGET_RECURRING_LOOKAHEAD_DAYS = env.int("BUDGET_RECURRING_LOOKAHEAD_DAYS", default=3)

# Default primary key field type
# https://docs.djangoproject.com/en/6.0/ref/settings/#default-auto-field
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CACHE SETTINGS
# Redis scheme docs: https://redis-py.readthedocs.io/en/stable/connections.html#redis.connection.ConnectionPool.from_url
REDIS_URL = env("REDIS_URL", default="redis://redis:6379/0")
REDIS_PREFIX = env("REDIS_PREFIX", default="")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "KEY_PREFIX": REDIS_PREFIX,
    }
}

# CELERY SETTINGS
# Celery configuration docs: https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html#configuration
CELERY_BROKER_URL = REDIS_URL
CELERY_BROKER_TRANSPORT_OPTIONS = {"global_keyprefix": REDIS_PREFIX}

INERTIA_LAYOUT = "app.html"

DJANGO_VITE = {
    "default": {
        "dev_mode": DEBUG,
        "dev_server_host": "localhost",
        "dev_server_port": 3000,
    }
}

SESSION_ENGINE = "django.contrib.sessions.backends.cache"

SITE_ID = 1
SITE_NAME = "Budgeteer"

# DJANGO DEBUG TOOLBAR SETTINGS
if DEBUG is True:
    INSTALLED_APPS += ["debug_toolbar"]
    MIDDLEWARE += ["debug_toolbar.middleware.DebugToolbarMiddleware"]

    # Under Docker (esp. Docker Desktop on macOS) the browser's request reaches
    # the container with a SNAT'd source IP that isn't reliably in INTERNAL_IPS,
    # so the default show-callback hides the toolbar. Drop the IP check but keep
    # the DEBUG gate by reading the *live* setting: this keeps the toolbar off
    # under the test runner (which disables DEBUG and doesn't register djdt URLs).
    def _show_debug_toolbar(request):
        from django.conf import settings

        return settings.DEBUG

    DEBUG_TOOLBAR_CONFIG = {"SHOW_TOOLBAR_CALLBACK": _show_debug_toolbar}

# UNFOLD ADMIN SETTINGS (https://unfoldadmin.com/docs/configuration/settings/)
UNFOLD = {
    "SITE_TITLE": "Budgeteer Admin",
    "SITE_HEADER": "Budgeteer",
    "SITE_SYMBOL": "savings",  # Material Symbols icon shown in the header
    "SITE_ICON": {
        "light": lambda request: "/public/static/favicon2/favicon.svg",
        "dark": lambda request: "/public/static/favicon2/favicon.svg",
    },
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": True,
    "BORDER_RADIUS": "8px",
    "DASHBOARD_CALLBACK": "apps.base.admin_callbacks.dashboard_callback",
    "ENVIRONMENT": "apps.base.admin_callbacks.environment_callback",
    "COLORS": {
        "base": {
            "50": "250 250 250",
            "100": "244 244 245",
            "200": "228 228 231",
            "300": "212 212 216",
            "400": "161 161 170",
            "500": "113 113 122",
            "600": "82 82 91",
            "700": "63 63 70",
            "800": "39 39 42",
            "900": "24 24 27",
            "950": "9 9 11",
        },
        "primary": {
            "50": "240 253 244",
            "100": "220 252 231",
            "200": "187 247 208",
            "300": "134 239 172",
            "400": "74 222 128",
            "500": "34 197 94",
            "600": "22 163 74",
            "700": "21 128 61",
            "800": "22 101 52",
            "900": "20 83 45",
            "950": "5 46 22",
        },
    },
}

# ALLAUTH SETTINGS (https://django-allauth.readthedocs.io/en/latest/configuration.html)
AUTHENTICATION_BACKENDS = ["allauth.account.auth_backends.AuthenticationBackend"]
LOGIN_REDIRECT_URL = "/"
ACCOUNT_LOGOUT_ON_GET = True
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_CONFIRM_EMAIL_ON_GET = True
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
# Set to "optional" so users can verify their email. Mailpit captures emails locally during development.
# For production, consider changing to "mandatory".
ACCOUNT_EMAIL_VERIFICATION = "optional"

# CUSTOM Django Base Site ALLAUTH settings used in the custom adapter (apps.accounts.auth_adapter)
ACCOUNT_ADAPTER = "apps.accounts.auth_adapter.AccountAdapter"
# Public signup is open so visitors from the landing page can create an account. On a self-hosted
# instance reachable from the internet, consider setting ACCOUNT_EMAIL_VERIFICATION = "mandatory"
# above to keep anonymous account creation in check.
ACCOUNT_SIGNUP_OPEN = True

if INSTANCE != "prod":
    # See https://github.com/migonzalvar/dj-email-url for more examples on how to set the EMAIL_URL
    email = env.dj_email_url(
        "EMAIL_URL",
        default="smtp://mailpit:1025",
    )
    DEFAULT_FROM_EMAIL = email.get("DEFAULT_FROM_EMAIL", "webmaster@localhost")
    EMAIL_HOST = email["EMAIL_HOST"]
    EMAIL_PORT = email["EMAIL_PORT"]
    EMAIL_HOST_PASSWORD = email["EMAIL_HOST_PASSWORD"]
    EMAIL_HOST_USER = email["EMAIL_HOST_USER"]
    EMAIL_USE_TLS = email["EMAIL_USE_TLS"]
else:
    # Use Django SES as the email backend for the production instance
    DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="")
    EMAIL_BACKEND = "django_ses.SESBackend"


def log_format() -> str:
    """Dump all available values into the JSON log output."""
    keys = (
        "asctime",
        "created",
        "levelname",
        "levelno",
        "filename",
        "funcName",
        "lineno",
        "module",
        "message",
        "name",
        "pathname",
        "process",
        "processName",
    )
    return " ".join([f"%({i:s})" for i in keys])


log_level = "WARNING"
IS_DEBUG_LOGGING_ON = env.bool("IS_DEBUG_LOGGING_ON", default=False)
if IS_DEBUG_LOGGING_ON is True:
    log_level = "DEBUG"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": log_format(),
            "class": "pythonjsonlogger.jsonlogger.JsonFormatter",
        },
    },
    "handlers": {
        # console logs to stderr
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        },
    },
    "loggers": {
        # default for all Python modules not listed below
        "": {
            "level": log_level,
            "handlers": ["console"],
        },
    },
}

# setup pretty logging for local dev
with contextlib.suppress(ModuleNotFoundError):
    import readable_log_formatter  # noqa: F401

    LOGGING["formatters"]["default"]["class"] = "readable_log_formatter.ReadableFormatter"

# MAINTENANCE MODE SETTINGS
MAINTENANCE_MODE_STATE_BACKEND = "maintenance_mode.backends.CacheBackend"
MAINTENANCE_MODE_STATE_BACKEND_FALLBACK_VALUE = True

VITE_DEV_MODE = env.bool("VITE_DEV_MODE", default=DEBUG)
