import json
from functools import lru_cache
from typing import TypeVar

from django import template
from django.conf import settings
from django.utils.safestring import mark_safe

T = TypeVar("T")

register = template.Library()


class ViteSettings:
    """Object to allow settings to be overridden in tests."""

    def _get_setting(self, var_name: str, default: T) -> T:
        return getattr(settings, var_name, default)

    @property
    def VITE_DEV_MODE(self):
        return self._get_setting("VITE_DEV_MODE", settings.DEBUG)

    @property
    def VITE_OUTPUT_DIR(self):
        return self._get_setting("VITE_OUTPUT_DIR", "dist/js/")

    @property
    def VITE_MANIFEST_FILE(self):
        return self._get_setting(
            "VITE_MANIFEST_FILE", settings.STATIC_ROOT.joinpath(self.VITE_OUTPUT_DIR, ".vite", "manifest.json")
        )

    @property
    def VITE_SERVER_HOST(self):
        return self._get_setting("VITE_SERVER_HOST", "localhost")

    @property
    def VITE_SERVER_PORT(self):
        return self._get_setting("VITE_SERVER_PORT", "3000")


vite_settings = ViteSettings()


def _get_css_link(filename: str) -> str:
    base_url = f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}"
    return mark_safe(f'<link rel="stylesheet" href="{base_url}{filename}">')  # noqa: S308


def _get_script_tag(filename: str) -> str:
    if vite_settings.VITE_DEV_MODE is False:
        base_url = f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}"
    else:
        base_url = f"http://{vite_settings.VITE_SERVER_HOST}:{vite_settings.VITE_SERVER_PORT}{settings.STATIC_URL}"
    return mark_safe(f'<script type="module" src="{base_url}{filename}"></script>')  # noqa: S308


@lru_cache
def _get_manifest():
    with open(vite_settings.VITE_MANIFEST_FILE) as f:
        content = f.read()
        manifest = json.loads(content)
        return manifest


def _get_file_data(filename: str) -> dict[str, str | list[str | None] | bool]:
    manifest = _get_manifest()
    # CSS direct entries appear under their own name; JS entries with imported CSS use .js key
    file_data = manifest.get(filename)
    if file_data is None and filename.endswith(".css"):
        file_data = manifest.get(filename.replace(".css", ".js"))
    if file_data is None:
        raise Exception(
            f'The vite asset "{filename}" was not found in the manifest file {vite_settings.VITE_MANIFEST_FILE}.'
        )
    return file_data


def built_asset_urls() -> list[str]:
    """
    Return a URL for every file the current Vite build emitted.

    The service worker precaches these. Unlike `vite_asset` it wants the whole build rather than one
    named entry point, including the stylesheets and assets a JS entry pulls in. Sorted so the same
    build always produces the same list, which is what the worker's cache version is derived from.
    """
    base_url = f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}"
    filenames: set[str] = set()
    for entry in _get_manifest().values():
        filenames.add(entry["file"])
        filenames.update(entry.get("css", []))
        filenames.update(entry.get("assets", []))
    return [f"{base_url}{filename}" for filename in sorted(filenames)]


def _get_css_asset(filename: str):
    if vite_settings.VITE_DEV_MODE is True:
        base_url = f"http://{vite_settings.VITE_SERVER_HOST}:{vite_settings.VITE_SERVER_PORT}"
        return mark_safe(f'<link rel="stylesheet" href="{base_url}{settings.STATIC_URL}{filename}">')  # noqa: S308
    direct = _get_manifest().get(filename)
    if direct is not None:
        # A standalone CSS entry (e.g. "css/main.css"): its own "file" is the stylesheet.
        hashed_filename = direct.get("file")
    else:
        # CSS emitted by a JS entry, reached via the .css -> .js fallback in _get_file_data.
        # That entry's "file" is the JS bundle, so the stylesheet must come from "css" —
        # preferring "file" here would emit a <link> pointing at a .js file.
        file_data = _get_file_data(filename)
        css_files = file_data.get("css")
        hashed_filename = css_files[0] if isinstance(css_files, list) and css_files else None
        if hashed_filename is None:
            raise Exception(
                f'The vite asset "{filename}" matched a manifest entry with no CSS output in '
                f"{vite_settings.VITE_MANIFEST_FILE}."
            )
    return _get_css_link(hashed_filename)  # type: ignore[arg-type]


def _get_js_asset(filename: str):
    if vite_settings.VITE_DEV_MODE is True:
        return _get_script_tag(filename)
    file_data = _get_file_data(filename)
    hashed_filename = file_data.get("file")
    return _get_script_tag(hashed_filename)  # type: ignore


@register.simple_tag
def vite_asset(filename: str):
    if str(filename).endswith("css") is True:
        return _get_css_asset(filename)
    return _get_js_asset(filename)


@register.filter(is_safe=True)
def safe_json(value: str) -> str:
    """Escape a JSON string for safe embedding in a <script> tag."""
    _escapes = {ord(">"): "\\u003E", ord("<"): "\\u003C", ord("&"): "\\u0026"}
    # Safe: the string's <, >, & are escaped to unicode above before marking safe.
    return mark_safe(str(value).translate(_escapes))  # noqa: S308


@register.simple_tag
def vite_modulepreload(filename: str) -> str:
    """
    Emit a modulepreload for every chunk the named entry statically imports.

    Vite normally writes these itself, but only into HTML it generates; here Django owns the page, so
    without them the browser can't discover the entry's dependencies until it has downloaded and
    parsed the entry — one serial round trip before the real work starts. That cost appeared when the
    pages were split into per-page chunks: the entry went from one self-contained file to a small
    stub plus a dozen shared chunks.

    Static imports only. The per-page chunks are dynamic imports and deliberately left out — the
    point of splitting them is not to fetch fifteen pages to render one.
    """
    if vite_settings.VITE_DEV_MODE is True:
        return ""
    manifest = _get_manifest()
    base_url = f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}"
    seen: set[str] = set()
    ordered: list[str] = []

    def walk(key: str) -> None:
        if key in seen:
            return
        seen.add(key)
        entry = manifest.get(key)
        if entry is None:
            return
        for imported in entry.get("imports", []):
            walk(imported)
        # Appended after its own imports so a dependency is preloaded before the chunk needing it.
        if key != filename:
            ordered.append(entry["file"])

    walk(filename)
    tags = "".join(f'<link rel="modulepreload" href="{base_url}{chunk}">' for chunk in ordered)
    return mark_safe(tags)  # noqa: S308


@register.simple_tag
def vite_font_preload() -> str:
    """
    Preload the Latin subset of the self-hosted Inter, which every page renders.

    Without this the font is only discovered after the stylesheet has been fetched and parsed, so it
    arrives a round trip after first paint and the page visibly reflows out of system-ui. Only the
    Latin subset is worth preloading: `latin-ext` exists for the currency symbols in U+20A0-20C0 and
    most budgets never render one, so preloading it would be 134 KB wasted on the common case.

    Nothing is emitted in dev mode, where the font is served unhashed straight off the Vite server.
    """
    url = vite_font_url()
    if not url:
        return ""
    # crossorigin is required even same-origin: fonts are always fetched in CORS mode, and a preload
    # whose mode doesn't match the real request is discarded and fetched a second time.
    return mark_safe(  # noqa: S308
        f'<link rel="preload" as="font" type="font/woff2" href="{url}" crossorigin>'
    )


@register.simple_tag
def vite_font_url() -> str:
    """
    Return the hashed URL of Inter's Latin subset, or "" in dev mode.

    Separate from `vite_font_preload` because the offline page needs the bare URL: it renders with no
    stylesheet of its own (the service worker serves it when no network is reachable), so it declares
    its own @font-face rather than linking main.css. The subset is precached alongside every other
    build asset, so it is genuinely available offline.
    """
    if vite_settings.VITE_DEV_MODE is True:
        return ""
    entry = _get_manifest().get("fonts/inter-latin.woff2")
    if entry is None:
        raise Exception(
            f"The self-hosted Inter subset was not found in the manifest file "
            f"{vite_settings.VITE_MANIFEST_FILE}. main.css should reference ../fonts/inter-latin.woff2."
        )
    return f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}{entry['file']}"


@register.simple_tag
def vite_react_refresh() -> str:
    if vite_settings.VITE_DEV_MODE is False:
        return mark_safe("")
    base_url = f"http://{vite_settings.VITE_SERVER_HOST}:{vite_settings.VITE_SERVER_PORT}{settings.STATIC_URL}"
    url = f"{base_url}@react-refresh"
    return mark_safe(  # noqa: S308
        f'<script type="module">\n'
        f"  import RefreshRuntime from '{url}'\n"
        f"  RefreshRuntime.injectIntoGlobalHook(window)\n"
        f"  window.$RefreshReg$ = () => {{}}\n"
        f"  window.$RefreshSig$ = () => (type) => type\n"
        f"  window.__vite_plugin_react_preamble_installed__ = true\n"
        f"</script>"
    )


@register.simple_tag
def vite_hmr_client() -> str:
    if vite_settings.VITE_DEV_MODE is False:
        return ""
    return _get_script_tag("@vite/client")
