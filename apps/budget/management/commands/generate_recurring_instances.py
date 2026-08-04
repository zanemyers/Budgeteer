import calendar

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone


class Command(BaseCommand):
    help = "Generate Transaction instances for all active RecurringTransaction schedules."

    def handle(self, *args, **options):
        from apps.budget.models import PaySchedule, RecurringTransaction

        lookahead = getattr(settings, "BUDGET_RECURRING_LOOKAHEAD_MONTHS", 3)
        today = timezone.localdate()

        year = today.year + (today.month + lookahead - 1) // 12
        month = (today.month + lookahead - 1) % 12 + 1
        through_date = today.replace(year=year, month=month, day=calendar.monthrange(year, month)[1])

        active_filter = (
            Q(is_active=True) & Q(start_date__lte=through_date) & (Q(end_date__isnull=True) | Q(end_date__gte=today))
        )
        schedules = RecurringTransaction.objects.filter(active_filter).select_related(
            "budget", "category", "created_by"
        )

        # Each schedule is generated independently. Without this, one bad row — a missing
        # currency, an unusable anchor — aborted the whole nightly run, including every
        # schedule queued behind it, and did so silently apart from a traceback in the log.
        failures: list[str] = []

        total_created = 0
        schedules_count = 0
        for schedule in schedules:
            try:
                created = schedule.generate_instances_up_to(through_date)
            except Exception as e:  # noqa: BLE001 - one bad schedule must not stop the rest
                failures.append(f"recurring #{schedule.pk} ({schedule.name}): {e}")
                continue
            total_created += len(created)
            schedules_count += 1

        # Pay schedules generate expected paycheck instances the same way.
        pay_schedules = PaySchedule.objects.select_related("budget", "category", "budget__created_by")
        pay_created = 0
        pay_count = 0
        for pay_schedule in pay_schedules:
            try:
                created = pay_schedule.generate_instances_up_to(through_date, since=today)
            except Exception as e:  # noqa: BLE001 - as above
                failures.append(f"pay schedule #{pay_schedule.pk} ({pay_schedule.name}): {e}")
                continue
            pay_created += len(created)
            pay_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Processed {schedules_count} recurring schedules ({total_created} instances) and "
                f"{pay_count} pay schedules ({pay_created} paychecks)."
            )
        )

        if failures:
            for failure in failures:
                self.stderr.write(self.style.ERROR(f"  {failure}"))
            # Non-zero exit so the failure is detectable, not just present in the log.
            raise CommandError(f"{len(failures)} schedule(s) failed to generate; the rest completed.")
