import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage, jsonFetch } from "../lib/api";
import type { BudgetOverviewCategory } from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";

interface Props {
  budgetPk: number;
  month: string;
  categories: BudgetOverviewCategory[];
  readyToAssign: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function AssignModal({ budgetPk, month, categories, readyToAssign, onClose, onSaved }: Props) {
  const symbol = useCurrencySymbol();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only assignable expense categories (excluding goals — they have their own contribution model).
  const assignable = useMemo(() => categories.filter((c) => c.category_type === "expense" && !c.is_goal), [categories]);

  const totalToAssign = useMemo(() => {
    return Object.values(drafts).reduce((sum, v) => {
      const n = Number.parseFloat(v);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
  }, [drafts]);

  const remaining = readyToAssign - totalToAssign;

  function setDraft(catId: number, value: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      if (value === "" || value === "0") delete next[catId];
      else next[catId] = value;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates = Object.entries(drafts)
        .map(([catIdStr, deltaStr]) => {
          const catId = Number(catIdStr);
          const delta = Number.parseFloat(deltaStr);
          if (!Number.isFinite(delta) || delta <= 0) return null;
          const current = assignable.find((c) => c.id === catId);
          if (!current) return null;
          const newAssigned = (Number.parseFloat(current.assigned) + delta).toFixed(2);
          return { catId, newAssigned };
        })
        .filter((u): u is { catId: number; newAssigned: string } => u !== null);

      if (updates.length === 0) {
        setError("Add an amount to at least one category.");
        setSaving(false);
        return;
      }

      // allSettled, not all: these are N independent writes, so a rejection partway through
      // leaves earlier ones already committed. Promise.all would abort here and skip
      // onSaved(), so the successful writes stayed invisible until the next page load.
      const results = await Promise.allSettled(
        updates.map((u) =>
          jsonFetch(`/budgets/${budgetPk}/category-budgets/${u.catId}/`, "PATCH", { assigned: u.newAssigned, month }),
        ),
      );
      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length === 0) {
        onSaved();
        return;
      }
      const reason = errorMessage((rejected[0] as PromiseRejectedResult).reason, "Something went wrong.");
      if (rejected.length === results.length) {
        // Nothing landed, so keep the modal open with the amounts intact to retry.
        setError(reason);
        setSaving(false);
        return;
      }
      // Some landed. Reload so the figures match the server, and toast because onSaved()
      // closes the modal and would take an in-modal message with it.
      toast.error(`Saved ${results.length - rejected.length} of ${results.length}. ${reason}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
      setSaving(false);
    }
  }

  function distributeEqually() {
    if (assignable.length === 0) return;
    const each = (readyToAssign / assignable.length).toFixed(2);
    setDrafts(Object.fromEntries(assignable.map((c) => [c.id, each])));
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign {fmt(readyToAssign, symbol)}</DialogTitle>
        </DialogHeader>

        <div className="py-2 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {assignable.length === 0 ? (
            <p className="text-sm text-ink-quiet">No expense categories yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assignable.map((cat) => {
                const currentAssigned = Number.parseFloat(cat.assigned);
                return (
                  <li key={cat.id} className="grid grid-cols-[1fr_auto_8rem] items-center gap-3 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{cat.name}</div>
                      <div className="text-xs text-ink-quiet tabular-nums">
                        {currentAssigned > 0 ? (
                          <>now {fmt(cat.assigned, symbol)}</>
                        ) : (
                          <span className="italic">unassigned</span>
                        )}
                      </div>
                    </div>
                    <span className="text-ink-quiet text-sm">+</span>
                    <div className="flex items-center gap-0">
                      <span className="inline-flex items-center px-2 h-9 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                        {symbol}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        className="h-9 rounded-l-none tabular-nums"
                        value={drafts[cat.id] ?? ""}
                        onChange={(e) => setDraft(cat.id, e.target.value)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex !justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-quiet">Remaining</span>
            <span className={`font-semibold tabular-nums ${remaining < 0 ? "text-expense" : "text-moss"}`}>
              {remaining < 0 ? "−" : ""}
              {fmt(Math.abs(remaining), symbol)}
            </span>
            {assignable.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={distributeEqually}>
                Split evenly
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || totalToAssign <= 0 || remaining < 0}
            >
              {saving ? "Assigning…" : `Assign ${fmt(totalToAssign, symbol)}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
