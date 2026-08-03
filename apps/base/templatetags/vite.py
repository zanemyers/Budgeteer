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


def _get_css_asset(filename: str):
    if vite_settings.VITE_DEV_MODE is True:
        base_url = f"http://{vite_settings.VITE_SERVER_HOST}:{vite_settings.VITE_SERVER_PORT}"
        return mark_safe(f'<link rel="stylesheet" href="{base_url}{settings.STATIC_URL}{filename}">')  # noqa: S308
    file_data = _get_file_data(filename)
    # CSS direct entry uses "file" key; CSS imported by JS uses "css" array
    hashed_filename = file_data.get("file") or (file_data.get("css") or [None])[0]  # type: ignore
    return _get_css_link(hashed_filename)  # type: ignore


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
