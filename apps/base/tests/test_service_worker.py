import json

from django.conf import settings
from django.test import override_settings

from apps.base.templatetags.vite import _get_manifest
from apps.base.tests import BaseTest

VITE_MANIFEST_FILE = settings.BASE_DIR / "apps" / "base" / "tests" / "vite_manifest.json"


class BaseServiceWorkerTest(BaseTest):
    def setUp(self):
        _get_manifest.cache_clear()

    def precache_list(self, body: str) -> list[str]:
        """Pull the PRECACHE array back out of the rendered worker."""
        line = next(line for line in body.splitlines() if line.startswith("const PRECACHE"))
        return json.loads(line.removeprefix("const PRECACHE = ").rstrip(";"))


@override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestServiceWorkerView(BaseServiceWorkerTest):
    def test_served_from_the_root_as_javascript(self):
        # A worker can only control pages at or below its own path, so serving this from
        # /public/static/ would silently limit its scope to the static tree.
        response = self.client.get("/sw.js")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Type"], "text/javascript")
        self.assertEqual(response.headers["Cache-Control"], "no-cache")

    def test_precaches_the_offline_page_and_the_whole_build(self):
        # "The whole build" is load-bearing now that the pages are split into per-page chunks and the
        # font is emitted by Vite: every shared chunk and both woff2 subsets have to be in here, or a
        # navigation offline would find its page chunk missing. built_asset_urls walks the entire
        # manifest for exactly this reason.
        response = self.client.get("/sw.js")
        self.assertEqual(
            self.precache_list(response.content.decode()),
            [
                "/offline/",
                "/public/static/dist/js/inter-latin-hashgoeshere.woff2",
                "/public/static/dist/js/main-hashgoeshere.css",
                "/public/static/dist/js/main-hashgoeshere.js",
                "/public/static/dist/js/shared-hashgoeshere.js",
                "/public/static/dist/js/vendor-hashgoeshere.js",
            ],
        )

    def test_version_changes_when_the_build_does(self):
        # The cache is named after the version, so a version that didn't move would leave users on
        # the previous build's JavaScript indefinitely.
        first = self.client.get("/sw.js").content.decode()
        with override_settings(VITE_OUTPUT_DIR="dist/other/"):
            _get_manifest.cache_clear()
            second = self.client.get("/sw.js").content.decode()
        self.assertNotEqual(
            next(line for line in first.splitlines() if line.startswith("const SHELL_CACHE")),
            next(line for line in second.splitlines() if line.startswith("const SHELL_CACHE")),
        )

    def test_anonymous_visitors_can_fetch_it(self):
        # Registration happens on every page, including the login page, before anyone has signed in.
        self.assertEqual(self.client.get("/sw.js").status_code, 200)


@override_settings(VITE_DEV_MODE=True, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestServiceWorkerInDevMode(BaseServiceWorkerTest):
    def test_precaches_only_the_offline_page(self):
        # Dev assets come off the Vite server under names that change on every edit, so precaching
        # them would pin the browser to whatever the code looked like when the worker installed.
        response = self.client.get("/sw.js")
        self.assertEqual(self.precache_list(response.content.decode()), ["/offline/"])


class TestOfflinePage(BaseServiceWorkerTest):
    def test_renders_for_anonymous_visitors(self):
        # It is precached and served with no network available, so it can't depend on a session.
        response = self.client.get("/offline/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "You're offline")

    def test_starts_with_the_doctype(self):
        # A stray leading byte — a `{# #}` comment Django didn't strip, say — puts the browser into
        # quirks mode, and this page has no stylesheet to compensate.
        body = self.client.get("/offline/").content.decode()
        self.assertTrue(body.lstrip().startswith("<!DOCTYPE html>"), body[:120])

    def test_pulls_in_no_external_assets(self):
        # Everything it needs has to be inline; a stylesheet or bundle reference would fail to load
        # in the exact situation this page exists for.
        body = self.client.get("/offline/").content.decode()
        self.assertNotIn('<link rel="stylesheet"', body)
        self.assertNotIn("fonts.googleapis.com", body)
        self.assertNotIn("<script src", body)
        self.assertNotIn(".js", body.split("<style>")[0])

    def test_the_only_referenced_asset_is_the_precached_font(self):
        """
        Inter is the single exception to the rule above, and only because the worker precaches it.

        Self-hosting the font made it available offline, so the page declares its own @font-face
        instead of settling for system-ui. Anything else reaching outside this document would still be
        a bug — the page renders precisely when the network is unreachable.
        """
        with override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE):
            _get_manifest.cache_clear()
            body = self.client.get("/offline/").content.decode()
        self.assertIn("@font-face", body)
        self.assertIn("inter-latin-hashgoeshere.woff2", body)

    def test_no_font_face_in_dev_mode(self):
        # The hashed filename doesn't exist until a build, so there is nothing to point at.
        body = self.client.get("/offline/").content.decode()
        self.assertNotIn("@font-face", body)
