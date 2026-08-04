import datetime

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone


class Command(BaseCommand):
    help = "Generate Transaction instances for all active RecurringTransaction schedules."

    def add_arguments(self, parser):
        parser.add_argument(
            "--prune",
            action="store_true",
            help=(
                "Delete unpaid generated instances due beyond the lookahead window and pull each "
                "schedule's watermark back to the window edge. Run this once after narrowing "
                "BUDGET_RECURRING_LOOKAHEAD_DAYS, otherwise the old instances linger and the "
                "watermark — already parked past the new window — generates nothing until it "
                "catches up. Off by default because it cannot distinguish a generated instance "
                "from one added by hand against the same schedule."
            ),
        )

    def prune(self, through_date):
        from apps.budget.models import PaySchedule, RecurringTransaction, Transaction

        stale = Transaction.objects.filter(
            Q(recurring__isnull=False) | Q(pay_schedule__isnull=False),
            paid_date__isnull=True,
            due_date__gt=through_date,
        )
        removed = stale.count()
        stale.delete()

        # Only ever pull a watermark backwards. One left short of the window edge is a schedule
        # mid-catch-up, and moving it forward would skip the instances it still owes.
        rewound = RecurringTransaction.objects.filter(generated_through__gt=through_date).update(
            generated_through=through_date
        ) + PaySchedule.objects.filter(generated_through__gt=through_date).update(generated_through=through_date)

        self.stdout.write(
            self.style.WARNING(
                f"Pruned {removed} unpaid instance(s) due after {through_date} "
                f"and rewound {rewound} watermark(s) to it."
            )
        )

    def handle(self, *args, **options):
        from apps.budget.models import PaySchedule, RecurringTransaction

        today = timezone.localdate()
        through_date = today + datetime.timedelta(days=settings.BUDGET_RECURRING_LOOKAHEAD_DAYS)

        if options["prune"]:
            self.prune(through_date)

        active_filter = Q(start_date__lte=through_date) & (Q(end_date__isnull=True) | Q(end_date__gte=today))
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
