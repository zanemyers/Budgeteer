import hashlib
import urllib.parse
from uuid import uuid4
from zoneinfo import available_timezones

from django.contrib.auth.models import AbstractUser
from django.db import models

TIMEZONE_CHOICES = sorted([(tz, tz) for tz in available_timezones()])


def avatar_thumbnail_path(instance, _filename):
    # Django's upload_to callable signature is (instance, filename); we replace
    # the client filename with a uuid so uploads never collide.
    return f"avatars/thumbnails/{instance.pk}/{uuid4().hex}.jpg"


class User(AbstractUser):
    default_budget = models.ForeignKey(
        "budget.Budget",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    last_viewed_budget = models.ForeignKey(
        "budget.Budget",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    timezone = models.CharField(max_length=63, default="America/Chicago", choices=TIMEZONE_CHOICES)
    currency = models.CharField(max_length=3, default="USD")
    avatar_thumbnail = models.ImageField(upload_to=avatar_thumbnail_path, blank=True)

    @property
    def avatar_url(self):
        if self.avatar_thumbnail:
            return self.avatar_thumbnail.url
        email_hash = hashlib.md5(self.email.lower().encode()).hexdigest()  # noqa: S324
        params = urllib.parse.urlencode({"d": "mp", "s": "256"})
        return f"https://www.gravatar.com/avatar/{email_hash}?{params}"
