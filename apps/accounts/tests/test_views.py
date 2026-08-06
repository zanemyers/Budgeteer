import json
import struct
import zlib
from io import BytesIO
from unittest.mock import patch

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse

from allauth.account.models import EmailAddress
from inertia.test import InertiaTestCase
from PIL import Image

from apps.accounts.models import User
from apps.banking.models import SimpleFINConnection
from apps.base.models import Currency

SETTINGS_URL = reverse("account_settings")


def _patch_json(client, payload):
    return client.patch(SETTINGS_URL, data=json.dumps(payload), content_type="application/json")


def _post_json(client, payload):
    return client.post(SETTINGS_URL, data=json.dumps(payload), content_type="application/json")


class AccountsTestCase(InertiaTestCase):
    def make_user(self, username="test.user"):
        return User.objects.create_user(username=username, email=f"{username}@example.com", password="password")  # noqa: S106


class TestAccountSettingsGet(AccountsTestCase):
    def test_requires_login(self):
        response = self.client.get(SETTINGS_URL)
        self.assertEqual(response.status_code, 302)

    def test_renders_settings_props(self):
        user = self.make_user()
        EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=True)
        Currency.objects.create(code="USD", name="US Dollar", symbol="$")
        SimpleFINConnection.objects.create(user=user, access_url="https://x", label="My Bank")
        self.client.force_login(user)
        self.client.get(SETTINGS_URL)

        self.assertComponentUsed("AccountSettings")
        props = self.props()
        self.assertEqual(props["currency"], "USD")
        self.assertEqual(len(props["email_addresses"]), 1)
        self.assertEqual(len(props["simplefin_connections"]), 1)
        self.assertEqual(props["simplefin_connections"][0]["label"], "My Bank")


class TestAccountSettingsProfile(AccountsTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.client.force_login(self.user)

    def test_update_name(self):
        response = _patch_json(self.client, {"action": "update_name", "first_name": "Ada", "last_name": "Lovelace"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Ada")
        self.assertEqual(self.user.last_name, "Lovelace")

    def test_update_name_without_action_is_rejected(self):
        # The settings page used to omit "action" here and silently get "Unknown action".
        response = _patch_json(self.client, {"first_name": "Ada", "last_name": "Lovelace"})
        self.assertEqual(response.status_code, 400)

    def test_update_timezone_valid(self):
        response = _patch_json(self.client, {"action": "update_timezone", "timezone": "America/New_York"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.timezone, "America/New_York")

    def test_update_timezone_invalid(self):
        response = _patch_json(self.client, {"action": "update_timezone", "timezone": "Mars/Phobos"})
        self.assertEqual(response.status_code, 400)

    def test_update_currency_valid(self):
        Currency.objects.create(code="EUR", name="Euro", symbol="€")
        response = _patch_json(self.client, {"action": "update_currency", "currency": "eur"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["currency_symbol"], "€")
        self.user.refresh_from_db()
        self.assertEqual(self.user.currency, "EUR")

    def test_update_currency_invalid(self):
        response = _patch_json(self.client, {"action": "update_currency", "currency": "ZZZ"})
        self.assertEqual(response.status_code, 400)

    def test_unknown_patch_action(self):
        response = _patch_json(self.client, {"action": "nonsense"})
        self.assertEqual(response.status_code, 400)

    def test_non_object_json_body_is_rejected_not_crashed(self):
        for body in ("null", "[1, 2]", '"hi"'):
            with self.subTest(body=body):
                response = self.client.patch(SETTINGS_URL, data=body, content_type="application/json")
                self.assertEqual(response.status_code, 400)


class TestAccountSettingsEmail(AccountsTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.primary = EmailAddress.objects.create(user=self.user, email=self.user.email, primary=True, verified=True)
        self.client.force_login(self.user)

    def test_add_email(self):
        response = _post_json(self.client, {"action": "add_email", "email": "second@example.com"})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(EmailAddress.objects.filter(user=self.user, email="second@example.com").exists())
        self.assertEqual(len(mail.outbox), 1)

    def test_add_email_rejects_duplicate(self):
        EmailAddress.objects.create(user=self.user, email="taken@example.com")
        response = _post_json(self.client, {"action": "add_email", "email": "taken@example.com"})
        self.assertEqual(response.status_code, 400)

    def test_add_email_requires_value(self):
        response = _post_json(self.client, {"action": "add_email", "email": ""})
        self.assertEqual(response.status_code, 400)

    def test_make_primary(self):
        other = EmailAddress.objects.create(user=self.user, email="other@example.com", verified=True)
        response = _patch_json(self.client, {"action": "make_primary", "email": "other@example.com"})
        self.assertEqual(response.status_code, 200)
        other.refresh_from_db()
        self.assertTrue(other.primary)

    def test_cannot_make_unverified_email_primary(self):
        EmailAddress.objects.create(user=self.user, email="unverified@example.com", verified=False)
        response = _patch_json(self.client, {"action": "make_primary", "email": "unverified@example.com"})
        self.assertEqual(response.status_code, 400)
        self.primary.refresh_from_db()
        self.assertTrue(self.primary.primary)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "test.user@example.com")

    def test_remove_non_primary_email(self):
        EmailAddress.objects.create(user=self.user, email="removable@example.com", primary=False)
        response = _patch_json(self.client, {"action": "remove_email", "email": "removable@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(EmailAddress.objects.filter(email="removable@example.com").exists())

    def test_cannot_remove_primary_email(self):
        response = _patch_json(self.client, {"action": "remove_email", "email": self.user.email})
        self.assertEqual(response.status_code, 400)
        self.assertTrue(EmailAddress.objects.filter(email=self.user.email).exists())

    def test_cannot_remove_only_email_even_when_not_primary(self):
        EmailAddress.objects.filter(user=self.user).update(primary=False)
        response = _patch_json(self.client, {"action": "remove_email", "email": self.user.email})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(EmailAddress.objects.filter(user=self.user).count(), 1)

    def test_resend_verification(self):
        response = _patch_json(self.client, {"action": "resend_verification", "email": self.user.email})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_resend_verification_unknown_email(self):
        response = _patch_json(self.client, {"action": "resend_verification", "email": "ghost@example.com"})
        self.assertEqual(response.status_code, 404)


class TestAccountSettingsPassword(AccountsTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.client.force_login(self.user)

    def test_change_password_success(self):
        old_hash = self.user.password
        response = _post_json(
            self.client,
            {
                "action": "change_password",
                "old_password": "password",
                "new_password": "a-fresh-passphrase",
                "confirm_password": "a-fresh-passphrase",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertNotEqual(self.user.password, old_hash)

    def test_change_password_wrong_old(self):
        response = _post_json(
            self.client,
            {
                "action": "change_password",
                "old_password": "not-it",
                "new_password": "a-fresh-passphrase",
                "confirm_password": "a-fresh-passphrase",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_change_password_mismatch(self):
        response = _post_json(
            self.client,
            {
                "action": "change_password",
                "old_password": "password",
                "new_password": "a-fresh-passphrase",
                "confirm_password": "different-passphrase",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_post_action(self):
        response = _post_json(self.client, {"action": "nonsense"})
        self.assertEqual(response.status_code, 400)


class TestAccountSettingsSimpleFIN(AccountsTestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.client.force_login(self.user)

    def test_claim_token_creates_connection(self):
        with patch("apps.accounts.views.claim_setup_token", return_value="https://access.example/xyz") as mock_claim:
            response = _post_json(
                self.client, {"action": "claim_simplefin_token", "setup_token": "abc", "label": "My Bank"}
            )
        self.assertEqual(response.status_code, 201)
        mock_claim.assert_called_once_with("abc")
        conn = SimpleFINConnection.objects.get(user=self.user)
        self.assertEqual(conn.label, "My Bank")
        self.assertEqual(conn.access_url, "https://access.example/xyz")

    def test_claim_token_surfaces_error(self):
        from apps.banking.simplefin import SimpleFINError

        with patch("apps.accounts.views.claim_setup_token", side_effect=SimpleFINError("bad token")):
            response = _post_json(self.client, {"action": "claim_simplefin_token", "setup_token": "abc"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "bad token")
        self.assertFalse(SimpleFINConnection.objects.exists())

    def test_remove_connection(self):
        conn = SimpleFINConnection.objects.create(user=self.user, access_url="https://x", label="B")
        response = _patch_json(self.client, {"action": "remove_simplefin_connection", "id": conn.pk})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(SimpleFINConnection.objects.filter(pk=conn.pk).exists())

    def test_remove_connection_not_found(self):
        response = _patch_json(self.client, {"action": "remove_simplefin_connection", "id": 999999})
        self.assertEqual(response.status_code, 404)

    def test_cannot_remove_another_users_connection(self):
        other = self.make_user(username="other")
        conn = SimpleFINConnection.objects.create(user=other, access_url="https://x", label="B")
        response = _patch_json(self.client, {"action": "remove_simplefin_connection", "id": conn.pk})
        self.assertEqual(response.status_code, 404)
        self.assertTrue(SimpleFINConnection.objects.filter(pk=conn.pk).exists())


@override_settings(
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
)
class TestAvatarUpload(AccountsTestCase):
    url = reverse("account_avatar")

    def setUp(self):
        super().setUp()
        self.user = self.make_user()
        self.client.force_login(self.user)

    def _jpeg(self, size=(300, 300)):
        buf = BytesIO()
        Image.new("RGB", size, "blue").save(buf, format="JPEG")
        return SimpleUploadedFile("avatar.jpg", buf.getvalue(), content_type="image/jpeg")

    def test_requires_login(self):
        self.client.logout()
        response = self.client.post(self.url, {"avatar": self._jpeg()})
        self.assertEqual(response.status_code, 302)

    def test_no_file(self):
        response = self.client.post(self.url, {})
        self.assertEqual(response.status_code, 400)

    def test_file_too_large(self):
        big = SimpleUploadedFile("big.jpg", b"x" * (5 * 1024 * 1024 + 1), content_type="image/jpeg")
        response = self.client.post(self.url, {"avatar": big})
        self.assertEqual(response.status_code, 400)

    def test_invalid_image(self):
        bad = SimpleUploadedFile("bad.jpg", b"not really an image", content_type="image/jpeg")
        response = self.client.post(self.url, {"avatar": bad})
        self.assertEqual(response.status_code, 400)

    def test_oversized_dimensions_rejected(self):
        # A forged IHDR is small on disk but claims 900M pixels, so Pillow raises
        # DecompressionBombError from Image.open before any decoding happens.
        ihdr = struct.pack(">II", 30000, 30000) + bytes([8, 2, 0, 0, 0])
        chunks = struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
        chunks += struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
        bomb = SimpleUploadedFile("bomb.png", b"\x89PNG\r\n\x1a\n" + chunks, content_type="image/png")
        response = self.client.post(self.url, {"avatar": bomb})
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.json()["error"])

    def test_valid_upload(self):
        response = self.client.post(self.url, {"avatar": self._jpeg()})
        self.assertEqual(response.status_code, 200)
        self.assertIn("avatar_url", response.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar_thumbnail)


class TestSignInView(AccountsTestCase):
    def test_get_renders_login_component(self):
        self.client.get(reverse("account_login"))
        self.assertComponentUsed("Login")

    def test_invalid_credentials_return_json_error_response(self):
        # An XHR login POST flows through SignInView into allauth's ajax handling,
        # which returns a 400 JSON body carrying the form errors.
        response = self.client.post(
            reverse("account_login"),
            data={"login": "nobody@example.com", "password": "wrong-password"},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers["Content-Type"], "application/json")
        self.assertIn("form", response.json())
