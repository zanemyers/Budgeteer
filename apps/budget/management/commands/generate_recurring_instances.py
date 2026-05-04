import calendar
import datetime

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q


class Command(BaseCommand):
    help = "Generate Transaction instances for all active RecurringTransaction schedules."

    def handle(self, *args, **options):
        from apps.budget.models import RecurringTransaction

        lookahead = getattr(settings, "BUDGET_RECURRING_LOOKAHEAD_MONTHS", 3)
        today = datetime.date.today()

        year = today.year + (today.month + lookahead - 1) // 12
        month = (today.month + lookahead - 1) % 12 + 1
        through_date = today.replace(year=year, month=month, day=calendar.monthrange(year, month)[1])

        active_filter = (
            Q(is_active=True)
            & Q(start_date__lte=through_date)
            & (Q(end_date__isnull=True) | Q(end_date__gte=today))
        )
        schedules = RecurringTransaction.objects.filter(active_filter).select_related(
            "budget", "category", "created_by"
        )

        total_created = 0
        schedules_count = 0
        for schedule in schedules:
            created = schedule.generate_instances_up_to(through_date)
            total_created += len(created)
            schedules_count += 1

        self.stdout.write(
            self.style.SUCCESS(f"Processed {schedules_count} schedules, created {total_created} instances.")
        )
