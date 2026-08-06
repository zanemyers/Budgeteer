"""Email backends that need adapting to Django's MAILERS setting."""

from django_ses import SESBackend


class SESMailerBackend(SESBackend):
    """
    django-ses under Django 6.1's MAILERS.

    django-ses 4.7.2 predates MAILERS: its __init__ forwards ``fail_silently=`` to
    BaseEmailBackend, which — when a backend is built for a mailer alias — treats any
    leftover kwarg as a configuration error and raises
    ``InvalidMailer: Unknown options 'fail_silently'``. Declaring it as already-handled
    lets the base class drop it instead, so the alias and every OPTIONS key still land
    on the real backend.

    Delete this and point MAILERS at ``django_ses.SESBackend`` once django-ses supports
    MAILERS; 4.7.2 is the newest release as of this writing and does not.
    """

    def __init__(self, **kwargs):
        super().__init__(_ignore_unknown_kwargs={"fail_silently"}, **kwargs)
