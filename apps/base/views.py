from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_POST


def http_500(request):
    raise Exception


def http_404(request):
    return render(request, "404.html")


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
