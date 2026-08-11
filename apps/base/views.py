import hashlib
import json

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from apps.base.templatetags.vite import built_asset_urls, vite_settings


def http_500(request):
    raise Exception


def http_404(request):
    return render(request, "404.html")


def offline(request):
    """Render the page the service worker falls back to when a navigation can't reach the network."""
    return render(request, "offline.html")


def service_worker(request):
    """
    Serve the service worker.

    It lives at the site root because a worker's scope can't reach above the path it was served from,
    and it is a view rather than a static file because the precache list has to name the current
    build's content-hashed filenames — which only the Vite manifest knows.
    """
    if vite_settings.VITE_DEV_MODE:
        # The dev server serves assets under unhashed names that change on every edit, so there is
        # nothing worth precaching. The worker still installs and still serves the offline page.
        assets: list[str] = []
        version = "dev"
    else:
        assets = built_asset_urls()
        version = hashlib.sha256("".join(assets).encode()).hexdigest()[:12]

    offline_url = reverse("offline")
    response = render(
        request,
        "sw.js",
        {
            "version": version,
            "offline_url": offline_url,
            "asset_prefix": f"{settings.STATIC_URL}{vite_settings.VITE_OUTPUT_DIR}",
            "precache": json.dumps([offline_url, *assets]),
        },
        content_type="text/javascript",
    )
    # Browsers revalidate the worker script on their own, but a cached copy here would also mean the
    # HTTP cache deciding when a new build's precache list takes effect.
    response["Cache-Control"] = "no-cache"
    return response


@require_POST
@staff_member_required
def refresh_exchange_rates(request):
    """Admin action: queue the update_exchange_rates Celery task. JSON for AJAX, redirect otherwise."""
    from apps.base.tasks import update_exchange_rates

    update_exchange_rates.delay()
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        return JsonResponse({"ok": True})
    messages.success(request, "Exchange rates refresh queued. Rates will update in a few seconds.")
    return redirect("admin:index")
