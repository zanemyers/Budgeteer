import re
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.test import override_settings

import pytest

from apps.base.templatetags.vite import (
    _get_manifest,
    vite_asset,
    vite_font_preload,
    vite_hmr_client,
    vite_modulepreload,
)
from apps.base.tests import BaseTest

VITE_MANIFEST_FILE = settings.BASE_DIR / "apps" / "base" / "tests" / "vite_manifest.json"
VITE_OUTPUT_DIR = "dist/"
VITE_SERVER_HOST = "example.com"
VITE_SERVER_PORT = "9999"
STATIC_URL = "/static/"


class BaseViteTest(BaseTest):
    def setUp(self):
        _get_manifest.cache_clear()


@override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=settings.BASE_DIR / "vite_manifest.json")
class TestViteAssetNoManifestFile(BaseViteTest):
    def test_manifest_file_does_not_exist(self):
        with pytest.raises(FileNotFoundError, match="No such file or directory"):
            vite_asset("js/main.js")


@override_settings(VITE_DEV_MODE=True, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestViteAssetDevModeOn(BaseViteTest):
    def test_js_asset(self):
        result = vite_asset("js/main.js")
        assert result == '<script type="module" src="http://localhost:3000/public/static/js/main.js"></script>'

        with override_settings(
            VITE_SERVER_HOST=VITE_SERVER_HOST, VITE_SERVER_PORT=VITE_SERVER_PORT, STATIC_URL=STATIC_URL
        ):
            result = vite_asset("js/main.js")
            assert result == '<script type="module" src="http://example.com:9999/static/js/main.js"></script>'

    def test_css_asset(self):
        # In dev mode the stylesheet is served straight off the Vite dev server, unhashed.
        # app.html requests 'css/main.css' this way, so returning "" here would leave the
        # SPA unstyled in development.
        result = vite_asset("js/main.css")
        assert result == '<link rel="stylesheet" href="http://localhost:3000/public/static/js/main.css">'

        with override_settings(
            VITE_SERVER_HOST=VITE_SERVER_HOST, VITE_SERVER_PORT=VITE_SERVER_PORT, STATIC_URL=STATIC_URL
        ):
            result = vite_asset("js/main.css")
            assert result == '<link rel="stylesheet" href="http://example.com:9999/static/js/main.css">'


@override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestViteAssetDevModeOff(BaseViteTest):
    def test_no_js_item(self):
        with pytest.raises(
            Exception,
            match=f'The vite asset "js/does_not_exist.js" was not found in the manifest file '
            f"{settings.BASE_DIR}/apps/base/tests/vite_manifest.json.",
        ):
            vite_asset("js/does_not_exist.js")

    def test_no_css_item(self):
        with pytest.raises(
            Exception,
            match=f'The vite asset "js/does_not_exist.css" was not found in the manifest file '
            f"{settings.BASE_DIR}/apps/base/tests/vite_manifest.json.",
        ):
            vite_asset("js/does_not_exist.css")

    def test_js_asset(self):
        result = vite_asset("js/main.js")
        assert result == '<script type="module" src="/public/static/dist/js/main-hashgoeshere.js"></script>'

        with override_settings(STATIC_URL=STATIC_URL, VITE_OUTPUT_DIR=VITE_OUTPUT_DIR):
            result = vite_asset("js/main.js")
            assert result == '<script type="module" src="/static/dist/main-hashgoeshere.js"></script>'

        with pytest.raises(
            Exception,
            match=f'The vite asset "js/does_not_exist.js" was not found in the manifest file '
            f"{settings.BASE_DIR}/apps/base/tests/vite_manifest.json.",
        ):
            vite_asset("js/does_not_exist.js")

    def test_css_asset(self):
        result = vite_asset("js/main.css")
        assert result == '<link rel="stylesheet" href="/public/static/dist/js/main-hashgoeshere.css">'

        with override_settings(STATIC_URL=STATIC_URL, VITE_OUTPUT_DIR=VITE_OUTPUT_DIR):
            result = vite_asset("js/main.css")
            assert result == '<link rel="stylesheet" href="/static/dist/main-hashgoeshere.css">'

        with pytest.raises(
            Exception,
            match=f'The vite asset "js/does_not_exist.css" was not found in the manifest file '
            f"{settings.BASE_DIR}/apps/base/tests/vite_manifest.json.",
        ):
            vite_asset("js/does_not_exist.css")


@override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestViteFontPreload(BaseViteTest):
    def test_preloads_the_hashed_latin_subset(self):
        # crossorigin is not optional: a font is always fetched in CORS mode, so a preload without it
        # is discarded and the font downloaded a second time.
        result = vite_font_preload()
        assert result == (
            '<link rel="preload" as="font" type="font/woff2" '
            'href="/public/static/dist/js/inter-latin-hashgoeshere.woff2" crossorigin>'
        )

    def test_only_the_latin_subset_is_preloaded(self):
        # latin-ext carries the U+20A0-20C0 currency symbols and most budgets never render one, so
        # preloading it would waste 134 KB on the common case.
        assert "latin-ext" not in vite_font_preload()

    def test_missing_font_entry_is_an_error_not_a_silent_omission(self):
        # Silently dropping the preload would leave the FOUT this tag exists to prevent, with nothing
        # to explain it. Patched rather than mutating the cached manifest, which would leak.
        with (
            mock.patch("apps.base.templatetags.vite._get_manifest", return_value={}),
            pytest.raises(Exception, match="The self-hosted Inter subset was not found"),
        ):
            vite_font_preload()

    @override_settings(VITE_DEV_MODE=True)
    def test_nothing_in_dev_mode(self):
        # The dev server serves the font unhashed, and the hashed name doesn't exist yet.
        assert vite_font_preload() == ""


@override_settings(VITE_DEV_MODE=False, VITE_MANIFEST_FILE=VITE_MANIFEST_FILE)
class TestViteModulePreload(BaseViteTest):
    def test_preloads_the_static_import_closure_dependencies_first(self):
        # main -> shared -> vendor. Vendor must come first: a preload for a chunk should be in flight
        # before the chunk that imports it needs it.
        result = vite_modulepreload("js/main.js")
        assert result == (
            '<link rel="modulepreload" href="/public/static/dist/js/vendor-hashgoeshere.js">'
            '<link rel="modulepreload" href="/public/static/dist/js/shared-hashgoeshere.js">'
        )

    def test_the_entry_itself_is_not_preloaded(self):
        # It already has a <script type="module"> tag; preloading it too would double-fetch.
        assert "main-hashgoeshere.js" not in vite_modulepreload("js/main.js")

    def test_unknown_entry_emits_nothing(self):
        assert vite_modulepreload("js/does_not_exist.js") == ""

    @override_settings(VITE_DEV_MODE=True)
    def test_nothing_in_dev_mode(self):
        assert vite_modulepreload("js/main.js") == ""


class TestViteManifestLocation(BaseViteTest):
    def test_the_manifest_is_not_read_from_static_root(self):
        """
        Collectstatic can never put the manifest in STATIC_ROOT, so reading it from there is a trap.

        staticfiles ignores `.*` by default and Vite emits to `.vite/manifest.json`, so the file is
        silently skipped — `collected_static/dist/js/.vite/` ends up an empty directory. The path only
        ever resolved while VITE_DEV_MODE was on, which is the one mode that never reads it; with it
        off the first vite_asset call raised FileNotFoundError and took every page down.
        """
        manifest = Path(settings.VITE_MANIFEST_FILE)
        static_root = Path(settings.STATIC_ROOT)
        self.assertFalse(
            manifest.is_relative_to(static_root),
            f"VITE_MANIFEST_FILE ({manifest}) is under STATIC_ROOT ({static_root}); "
            "point it at Vite's own outDir instead.",
        )

    def test_the_manifest_path_matches_vites_configured_output(self):
        # Guards the other half: the setting has to name the directory vite.config.mjs actually
        # writes to, or it resolves to a path no build ever produces.
        config = (Path(settings.BASE_DIR) / "vite.config.mjs").read_text(encoding="utf-8")
        out_dir = re.search(r'outDir:\s*"([^"]+)"', config).group(1)
        # outDir is relative to Vite's `root` ("src"), e.g. "../public/static/dist/js".
        expected = (Path(settings.BASE_DIR) / "src" / out_dir / ".vite" / "manifest.json").resolve()
        self.assertEqual(Path(settings.VITE_MANIFEST_FILE).resolve(), expected)


class TestViteHMRClientTagOn(BaseViteTest):
    @override_settings(VITE_DEV_MODE=True)
    def test_vite_hmr_client_dev_mode_on(self):
        result = vite_hmr_client()
        assert result == '<script type="module" src="http://localhost:3000/public/static/@vite/client"></script>'

        with override_settings(
            VITE_SERVER_HOST=VITE_SERVER_HOST, VITE_SERVER_PORT=VITE_SERVER_PORT, STATIC_URL=STATIC_URL
        ):
            result = vite_hmr_client()
            assert result == '<script type="module" src="http://example.com:9999/static/@vite/client"></script>'

    @override_settings(VITE_DEV_MODE=False)
    def test_vite_hmr_client_dev_mode_off(self):
        result = vite_hmr_client()
        assert result == ""
