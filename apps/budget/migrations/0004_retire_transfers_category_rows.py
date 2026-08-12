from django.db import migrations


def retire_transfers_category_rows(apps, schema_editor):
    """
    Clear out the rows still sitting in the hidden "Transfers" system category.

    0002 handled *paired* legs. These are the ones it could not see: single legs created by the
    confirm-as-transfer flow's "link against an existing transaction" path, which never had a
    `transfer_partner` to match on. They kept a line in the system category, and the bank rows still
    linked to them kept teaching the merchant-rule suggester, which is why "Create in Transfers —
    Suggested 85%" survived the code removal.

    Worse than clutter: `derive_transaction_type()` falls back to the line's category type when
    `transaction_type` is blank, and the Transfers category is TYPE_EXPENSE — so a bank-backed row
    here counts as real expense spending in a category no user-facing list will show.

    Same two-way split 0002 used, for the same reason:

    * A row a bank row stands behind is deleted, and its bank row goes back to `pending`. Nothing is
      lost — the bank row still carries the date, payee, amount and memo — and it lands back in the
      review queue where Ignore, the replacement for the whole transfer feature, can deal with it.
    * A row with no bank row is left exactly as it is. It is the only record that money moved, so
      deleting it would destroy data. These are already `transaction_type="transfer"`, which keeps
      them out of both income and category activity.

    The system category itself stays: `TransactionLine.category` is PROTECT and the rows in the
    second group still point at it.
    """
    Transaction = apps.get_model("budget", "Transaction")
    BankTransaction = apps.get_model("banking", "BankTransaction")

    ids = list(Transaction.objects.filter(lines__category__is_system=True).distinct().values_list("pk", flat=True))
    if not ids:
        return

    bank_rows = list(BankTransaction.objects.filter(transaction_id__in=ids))
    if not bank_rows:
        return

    # Captured before the loop below: unlinking sets transaction_id to None on these instances, so
    # reading it afterwards would delete nothing.
    bank_backed_ids = [bt.transaction_id for bt in bank_rows]

    for bt in bank_rows:
        bt.status = "pending"
        bt.ignore_reason = ""
        bt.transaction = None
        bt.save(update_fields=["status", "ignore_reason", "transaction"])

    # Only the bank-backed ones. Deleting a transaction cascades to its lines, so the surviving rows
    # keep their system-category lines and the category stays undeletable — deliberately.
    Transaction.objects.filter(pk__in=bank_backed_ids).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0003_drop_transfer_partner"),
        ("banking", "0001_initial_squashed_0009_bankaccount_budget"),
    ]

    operations = [
        # Not reversible: the deleted rows cannot be reconstructed. Their bank rows survive, which is
        # what makes the deletion safe to do at all.
        migrations.RunPython(retire_transfers_category_rows, migrations.RunPython.noop),
    ]
