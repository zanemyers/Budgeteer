"""
Initial migration for the banking app.

Banking models previously lived in `apps.base`. The actual DB tables already
exist (`base_simplefinconnection`, `base_bankaccount`, `base_banktransaction`).
This migration adds them to the banking app's state without touching the DB —
the matching `base.0006_move_banking_models_out` removes them from base's state.

Each model's Meta sets `db_table` to the original `base_*` name to preserve
the table name in Postgres.
"""

from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.base.fields


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("base", "0005_drop_last_sync_status"),
        ("budget", "0018_sinking_fund_table"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="SimpleFINConnection",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                            ),
                        ),
                        ("label", models.CharField(blank=True, default="", max_length=100)),
                        ("access_url", apps.base.fields.EncryptedTextField()),
                        ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                        ("last_sync_error", models.TextField(blank=True, default="")),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "user",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="simplefin_connections",
                                to=settings.AUTH_USER_MODEL,
                            ),
                        ),
                    ],
                    options={
                        "db_table": "base_simplefinconnection",
                        "ordering": ["-created_at"],
                        "verbose_name": "SimpleFIN Connection",
                        "verbose_name_plural": "SimpleFIN Connections",
                    },
                ),
                migrations.CreateModel(
                    name="BankAccount",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                            ),
                        ),
                        ("simplefin_id", models.CharField(max_length=255)),
                        ("name", models.CharField(max_length=255)),
                        ("org_name", models.CharField(blank=True, default="", max_length=255)),
                        ("org_domain", models.CharField(blank=True, default="", max_length=255)),
                        ("currency", models.CharField(default="USD", max_length=3)),
                        ("balance", models.DecimalField(blank=True, decimal_places=2, max_digits=16, null=True)),
                        (
                            "available_balance",
                            models.DecimalField(blank=True, decimal_places=2, max_digits=16, null=True),
                        ),
                        ("balance_as_of", models.DateTimeField(blank=True, null=True)),
                        ("is_hidden", models.BooleanField(default=False)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "connection",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="bank_accounts",
                                to="banking.simplefinconnection",
                            ),
                        ),
                        (
                            "payment_method",
                            models.ForeignKey(
                                blank=True,
                                null=True,
                                on_delete=django.db.models.deletion.SET_NULL,
                                related_name="bank_accounts",
                                to="budget.paymentmethod",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "base_bankaccount",
                        "ordering": ["org_name", "name"],
                        "unique_together": {("connection", "simplefin_id")},
                    },
                ),
                migrations.CreateModel(
                    name="BankTransaction",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                            ),
                        ),
                        ("simplefin_id", models.CharField(max_length=255)),
                        ("posted_at", models.DateTimeField()),
                        ("amount", models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=14)),
                        ("description", models.CharField(blank=True, default="", max_length=500)),
                        ("payee", models.CharField(blank=True, default="", max_length=255)),
                        ("memo", models.CharField(blank=True, default="", max_length=500)),
                        ("is_pending_at_bank", models.BooleanField(default=False)),
                        ("raw", models.JSONField(blank=True, default=dict)),
                        (
                            "status",
                            models.CharField(
                                choices=[("pending", "Pending"), ("linked", "Linked"), ("ignored", "Ignored")],
                                default="pending",
                                max_length=10,
                            ),
                        ),
                        ("first_seen_at", models.DateTimeField(auto_now_add=True)),
                        ("last_seen_at", models.DateTimeField(auto_now=True)),
                        (
                            "bank_account",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="bank_transactions",
                                to="banking.bankaccount",
                            ),
                        ),
                        (
                            "transaction",
                            models.OneToOneField(
                                blank=True,
                                null=True,
                                on_delete=django.db.models.deletion.SET_NULL,
                                related_name="bank_transaction",
                                to="budget.transaction",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "base_banktransaction",
                        "ordering": ["-posted_at"],
                        "indexes": [
                            models.Index(fields=["status", "posted_at"], name="base_banktr_status_980c92_idx"),
                        ],
                        "unique_together": {("bank_account", "simplefin_id")},
                    },
                ),
            ],
        ),
    ]
