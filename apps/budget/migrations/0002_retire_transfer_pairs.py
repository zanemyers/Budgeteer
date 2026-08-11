from django.db import migrations


def retire_transfer_pairs(apps, schema_editor):
    """
    Retire the two-leg transfer pairing.

    The Transfers tab is gone and transfers are handled by ignoring the bank row instead, so the
    pairing no longer means anything. Each paired leg goes one of two ways:

    * A leg that came from a bank sync is deleted and its bank row is put back to `pending`, which
      is the state it was in before it was confirmed as a transfer. Nothing is lost — the bank row
      still carries the date, payee, amount and memo — and it lands back in the review queue where
      the Ignore action can deal with it.
    * A leg that was entered by hand has no bank row to return to, so it stays exactly as it is and
      simply stops being paired. Deleting it would destroy the only record of that money moving.

    `transaction_type="transfer"` is deliberately left alone: goal deposits use it, and the
    ready-to-assign and goal-balance sums in `data.py` key off it.
    """
    Transaction = apps.get_model("budget", "Transaction")
    BankTransaction = apps.get_model("banking", "BankTransaction")

    paired_ids = list(Transaction.objects.filter(transfer_partner__isnull=False).values_list("pk", flat=True))
    if not paired_ids:
        return

    # Which legs a bank row is standing behind, recorded before anything is unpaired or deleted.
    bank_rows = list(BankTransaction.objects.filter(transaction_id__in=paired_ids))
    bank_backed_ids = [bt.transaction_id for bt in bank_rows]

    # Unpair first. transfer_partner is SET_NULL on both sides, so this is not strictly required to
    # avoid a cascade — but it means the delete below cannot touch a partner by accident.
    Transaction.objects.filter(pk__in=paired_ids).update(transfer_partner=None)

    for bt in bank_rows:
        bt.status = "pending"
        bt.ignore_reason = ""
        bt.transaction = None
        bt.save(update_fields=["status", "ignore_reason", "transaction"])

    Transaction.objects.filter(pk__in=bank_backed_ids).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("budget", "0001_initial_squashed_0031_remove_recurringtransaction_is_active"),
        ("banking", "0001_initial_squashed_0009_bankaccount_budget"),
    ]

    operations = [
        # Not reversible: the deleted legs cannot be reconstructed. Their bank rows survive, which is
        # what makes the deletion safe to do at all.
        migrations.RunPython(retire_transfer_pairs, migrations.RunPython.noop),
    ]
