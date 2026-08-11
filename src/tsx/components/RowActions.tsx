import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  /** Row label. Names the menu for screen readers and the row in the confirm dialog. */
  name: string;
  /** Singular noun for the dialog copy, e.g. "goal" → "Delete this goal?". */
  noun: string;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

/**
 * The edit + delete pair for a table or list row, collapsed into one overflow menu.
 *
 * A standing "Delete" button per row cost about 120px of every row, which at phone width was taken
 * straight out of the column that says *which* row it is — names rendered as "Comme…"/"Wealthfr…".
 * It also put a destructive control one mis-tap from the edit button.
 *
 * Callers own their error reporting: `onDelete` is expected to catch and surface its own failure
 * (usually a message on the row), so the dialog closes either way rather than trapping the user
 * behind a modal that hides the explanation.
 */
export function RowActions({ name, noun, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} title={`${noun} actions`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        {/* Sized to the longest noun in use ("recurring transaction") so the items never wrap. */}
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem className="whitespace-nowrap" onClick={onEdit}>
            <Pencil />
            Edit {noun}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="whitespace-nowrap" variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete {noun}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this {noun}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-quiet">{name} will be removed. This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void run()} disabled={busy}>
              {busy ? "Deleting…" : `Delete ${noun}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
