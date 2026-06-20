import { useMemo, useState } from "react";
import type { BudgetOverviewCategory } from "../types";
import { getCsrfToken } from "../lib/api";
import { fmt, useCurrencySymbol } from "../utils/currency";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
  budgetPk: number;
  month: string;
  categories: BudgetOverviewCategory[];
  overAssignedBy: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function CleanupAssignedModal({ budgetPk, month, categories, overAssignedBy, onClose, onSaved }: Props) {
  const symbol = useCurrencySymbol();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assigned = useMemo(
    () =>
      categories
        .filter((c) => c.category_type === "expense" && !c.is_goal && Number.parseFloat(c.assigned) > 0)
        .sort((a, b) => Number.parseFloat(b.assigned) - Number.parseFloat(a.assigned)),
    [categories],
  );

  const totalReduction = useMemo(() => {
    return Object.entries(drafts).reduce((sum, [catIdStr, value]) => {
      const cat = assigned.find((c) => c.id === Number(catIdStr));
      if (!cat) return sum;
      const n = Number.parseFloat(value);
      const cap = Number.parseFloat(cat.assigned);
      const clamped = !Number.isFinite(n) || n < 0 ? 0 : Math.min(n, cap);
      return sum + clamped;
    }, 0);
  }, [drafts, assigned]);

  const stillOver = overAssignedBy - totalReduction;

  function setDraft(catId: number, value: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      if (value === "" || value === "0") delete next[catId];
      else next[catId] = value;
      return next;
    });
  }

  function zeroOut(cat: BudgetOverviewCategory) {
    setDraft(cat.id, cat.assigned);
  }

  function clearAllAuto() {
    // Auto-distribute the reduction across categories proportional to their assigned amounts,
    // capped at each category's current value.
    let remaining = overAssignedBy;
    const totalAssigned = assigned.reduce((s, c) => s + Number.parseFloat(c.assigned), 0);
    if (totalAssigned <= 0) return;
    const next: Record<number, string> = {};
    for (const cat of assigned) {
      const share = Number.parseFloat(cat.assigned) / totalAssigned;
      const reduce = Math.min(Number.parseFloat(cat.assigned), remaining * share);
      if (reduce > 0) next[cat.id] = reduce.toFixed(2);
      remaining -= reduce;
    }
    setDrafts(next);
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
          const cat = assigned.find((c) => c.id === catId);
          if (!cat) return null;
          const current = Number.parseFloat(cat.assigned);
          const newAssigned = Math.max(0, current - delta).toFixed(2);
          return { catId, newAssigned };
        })
        .filter((u): u is { catId: number; newAssigned: string } => u !== null);

      if (updates.length === 0) {
        setError("Pick at least one category to reduce.");
        setSaving(false);
        return;
      }

      await Promise.all(
        updates.map((u) =>
          fetch(`/budgets/${budgetPk}/category-budgets/${u.catId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
            body: JSON.stringify({ assigned: u.newAssigned, month }),
          }),
        ),
      );

      onSaved();
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reduce by {fmt(overAssignedBy, symbol)}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-ink-quiet -mt-1">
          You've assigned more than your income. Pull amounts back from individual categories or split it proportionally.
        </p>

        <div className="py-2 flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {assigned.length === 0 ? (
            <p className="text-sm text-ink-quiet">Nothing currently assigned.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assigned.map((cat) => {
                const draftVal = drafts[cat.id] ?? "";
                const current = Number.parseFloat(cat.assigned);
                const draftNum = Number.parseFloat(draftVal);
                const newAfter = Number.isFinite(draftNum) && draftNum > 0
                  ? Math.max(0, current - Math.min(draftNum, current))
                  : current;
                return (
                  <li key={cat.id} className="grid grid-cols-[1fr_auto_8rem] items-center gap-3 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{cat.name}</div>
                      <div className="text-xs text-ink-quiet tabular-nums">
                        {fmt(cat.assigned, symbol)}
                        {draftVal && (
                          <> &rarr; <span className="text-moss">{fmt(newAfter, symbol)}</span></>
                        )}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="xs" onClick={() => zeroOut(cat)}>
                      Zero
                    </Button>
                    <div className="flex items-center gap-0">
                      <span className="inline-flex items-center px-2 h-9 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">−{symbol}</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        max={cat.assigned}
                        placeholder="0"
                        className="h-9 rounded-l-none tabular-nums"
                        value={draftVal}
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
            <span className="text-ink-quiet">{stillOver > 0 ? "Still over by" : stillOver < 0 ? "Reducing too far" : "Balanced"}</span>
            {stillOver !== 0 && (
              <span className={`font-semibold tabular-nums ${stillOver > 0 ? "text-expense" : "text-fund"}`}>
                {fmt(Math.abs(stillOver), symbol)}
              </span>
            )}
            {assigned.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={clearAllAuto}>
                Auto-split
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving || totalReduction <= 0}>
              {saving ? "Reducing…" : `Reduce ${fmt(totalReduction, symbol)}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
