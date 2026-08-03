from django.db import migrations


def mark_existing_onboarded(apps, schema_editor):
    """Existing users predate onboarding — mark them complete so only new signups see the wizard."""
    User = apps.get_model("accounts", "User")
    User.objects.update(onboarding_completed=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0009_user_onboarding_completed"),
    ]

    operations = [
        migrations.RunPython(mark_existing_onboarded, noop),
    ]
