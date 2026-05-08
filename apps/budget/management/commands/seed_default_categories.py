from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.budget.models import Budget, Category

DEFAULTS: dict[str, list[tuple[str, list[str]]]] = {
    "income": [
        ("Salary", []),
        ("Other Income", []),
    ],
    "expense": [
        ("Food", ["Groceries", "Eating Out", "Coffee"]),
        ("Housing", ["Rent / Mortgage", "Utilities", "Internet", "Home Maintenance"]),
        ("Transportation", ["Gas", "Auto Insurance", "Maintenance", "Public Transit", "Parking"]),
        ("Health", ["Insurance", "Pharmacy", "Doctor", "Dental"]),
        ("Personal", ["Clothing", "Hair / Grooming", "Subscriptions"]),
        ("Entertainment", ["Streaming", "Hobbies", "Books / Media"]),
        ("Giving", []),
        ("Gifts", []),
        ("Misc", []),
    ],
}


class Command(BaseCommand):
    help = "Seed a budget with a default category tree (idempotent — skips categories that already exist)."

    def add_arguments(self, parser):
        parser.add_argument("budget_pk", type=int, help="Budget primary key to seed.")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            budget = Budget.objects.get(pk=options["budget_pk"])
        except Budget.DoesNotExist as e:
            raise CommandError(f"Budget #{options['budget_pk']} not found.") from e

        created_root = 0
        created_sub = 0
        skipped = 0

        for category_type, roots in DEFAULTS.items():
            for root_name, subs in roots:
                root, was_created = Category.objects.get_or_create(
                    budget=budget,
                    parent=None,
                    name=root_name,
                    category_type=category_type,
                )
                if was_created:
                    created_root += 1
                else:
                    skipped += 1
                for sub_name in subs:
                    _, sub_was_created = Category.objects.get_or_create(
                        budget=budget,
                        parent=root,
                        name=sub_name,
                        defaults={"category_type": category_type},
                    )
                    if sub_was_created:
                        created_sub += 1
                    else:
                        skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seeded budget {budget.pk}: {created_root} root + {created_sub} subcategories created, {skipped} already existed."
        ))
