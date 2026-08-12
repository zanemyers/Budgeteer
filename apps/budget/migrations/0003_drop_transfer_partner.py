from django.db import migrations


class Migration(migrations.Migration):
    """
    Drop the column behind the retired two-leg transfer pairing.

    0002 unpaired every row and cleared the feature's data; this removes the field itself along with
    `link_transfer`/`unlink_transfer` and the three views that drove it. Transfers are handled by
    ignoring the bank row instead, which needs no second leg to point at.

    `transaction_type="transfer"` stays: goal deposits use it, and the ready-to-assign and
    goal-balance sums in `data.py` key off it.
    """

    dependencies = [
        ("budget", "0002_retire_transfer_pairs"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="transaction",
            name="transfer_partner",
        ),
    ]
