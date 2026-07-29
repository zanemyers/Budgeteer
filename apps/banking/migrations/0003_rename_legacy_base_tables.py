"""Rename the legacy `base_*` tables to the banking app defaults.

These tables were created while the models lived in `apps.base`, then moved to
`apps.banking` via a state-only migration that kept the old `db_table` names.
Dropping those `db_table` overrides lets Django use its defaults, so this
migration renames the tables to match (`base_bankaccount` -> `banking_bankaccount`, etc.).

The status index is a special case: migration state recorded it as
`base_banktr_status_980c92_idx`, but the name actually present in Postgres is
`base_bankt_status_55b5fb_idx` (the two drifted during the app move). A plain
RenameIndex would emit SQL against the state name and fail, so we split it —
RunSQL renames the real index, while the state operation keeps Django's model
state in sync. Table/index renames are metadata-only in Postgres.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("banking", "0002_banktransaction_ignore_reason"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql='ALTER INDEX "base_bankt_status_55b5fb_idx" RENAME TO "banking_ban_status_25ad4b_idx";',
                    reverse_sql='ALTER INDEX "banking_ban_status_25ad4b_idx" RENAME TO "base_bankt_status_55b5fb_idx";',
                ),
            ],
            state_operations=[
                migrations.RenameIndex(
                    model_name="banktransaction",
                    new_name="banking_ban_status_25ad4b_idx",
                    old_name="base_banktr_status_980c92_idx",
                ),
            ],
        ),
        migrations.AlterModelTable(name="bankaccount", table=None),
        migrations.AlterModelTable(name="banktransaction", table=None),
        migrations.AlterModelTable(name="simplefinconnection", table=None),
    ]
