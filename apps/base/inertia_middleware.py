from django.contrib.messages import get_messages

from inertia import share


class InertiaShareMiddleware:
    """Share auth and flash data with every Inertia response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            share(
                request,
                auth={
                    "user": {
                        "id": request.user.pk,
                        "email": request.user.email,
                        "name": request.user.get_full_name() or request.user.email,
                        "gravatar": request.user._get_gravatar_url(),
                        "is_staff": request.user.is_staff,
                    }
                },
            )

        response = self.get_response(request)

        # Forward Django messages as flash props on the *next* request via session,
        # but we can also attach them to the current response for redirects.
        flash_messages = [
            {"level": m.level_tag, "message": str(m)}
            for m in get_messages(request)
        ]
        if flash_messages:
            share(request, flash=flash_messages)

        return response
