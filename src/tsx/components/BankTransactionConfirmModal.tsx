import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { jsonFetch } from "../lib/api";
import type { BankMatchSuggestion, BankTransaction, Category, Transaction } from "../types";
import { fmt, fmtSigned, useCurrencySymbol } from "../utils/currency";
import { fmtDate } from "../utils/date";

interface NewLine {
  category: string;
  amount: string;
  description: string;
}

interface Props {
  bankTxn: BankTransaction;
  budgetPk: number;
  categories: Category[];
  onResolved: (result: { bankTxn: BankTransaction; transaction?: Transaction | null }) => void;
  onClose: () => void;
}

export default function BankTransactionConfirmModal({ bankTxn, budgetPk, categories, onResolved, onClose }: Props) {
  const symbol = useCurrencySymbol();
  const [suggestions, setSuggestions] = useState<BankMatchSuggestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [ignoreMode, setIgnoreMode] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");
  const [newDescription, setNewDescription] = useState(bankTxn.payee || bankTxn.description);
  const bankAmount = Math.abs(Number.parseFloat(bankTxn.amount));
  const [newLines, setNewLines] = useState<NewLine[]>(() => [
    { category: "", amount: bankAmount.toFixed(2), description: "" },
  ]);
  const [createError, setCreateError] = useState<string | null>(null);

  const linesTotal = newLines.reduce((sum, l) => {
    const n = Number.parseFloat(l.amount);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);
  const linesTotalDelta = +(linesTotal - bankAmount).toFixed(2);
  const totalMatches = Math.abs(linesTotalDelta) < 0.005;
  const allLinesValid = newLines.every((l) => l.category && Number.parseFloat(l.amount) > 0);

  useEffect(() => {
    let cancelled = false;
    jsonFetch<{ suggestions: BankMatchSuggestion[] }>(
      `/budgets/${budgetPk}/bank-transactions/${bankTxn.id}/suggestions/`,
      "GET",
    )
      .then((data) => {
        if (!cancelled && data) setSuggestions(data.suggestions);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load suggestions.");
      });
    return () => {
      cancelled = true;
    };
  }, [bankTxn.id, budgetPk]);

  async function applySuggestion(s: BankMatchSuggestion) {
    setBusy(true);
    try {
      if (s.kind === "merchant_rule" && s.category_id !== null) {
        const data = await jsonFetch<{ bank_transaction: BankTransaction; transaction: Transaction }>(
          `/budgets/${budgetPk}/bank-transactions/${bankTxn.id}/create-transaction/`,
          "POST",
          { category_id: s.category_id, description: bankTxn.payee || bankTxn.description },
        );
        if (data)
          onResolved({
            bankTxn: data.bank_transaction,
            transaction: data.transaction,
          });
        return;
      }
      if (s.transaction_id !== null) {
        const data = await jsonFetch<{ bank_transaction: BankTransaction; transaction: Transaction }>(
          `/budgets/${budgetPk}/bank-transactions/${bankTxn.id}/link/`,
          "POST",
          {
            transaction_id: s.transaction_id,
          },
        );
        if (data)
          onResolved({
            bankTxn: data.bank_transaction,
            transaction: data.transaction,
          });
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  function updateLine(idx: number, patch: Partial<NewLine>) {
    setNewLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    const remaining = Math.max(0, +(bankAmount - linesTotal).toFixed(2));
    setNewLines((prev) => [...prev, { category: "", amount: remaining.toFixed(2), description: "" }]);
  }
  function removeLine(idx: number) {
    setNewLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function createNew() {
    if (!allLinesValid || !totalMatches) return;
    setBusy(true);
    setCreateError(null);
    try {
      const data = await jsonFetch<{ bank_transaction: BankTransaction; transaction: Transaction }>(
        `/budgets/${budgetPk}/bank-transactions/${bankTxn.id}/create-transaction/`,
        "POST",
        {
          description: newDescription,
          lines: newLines.map((l) => ({
            category_id: Number(l.category),
            amount: l.amount,
            description: l.description,
          })),
        },
      );
      if (data)
        onResolved({
          bankTxn: data.bank_transaction,
          transaction: data.transaction,
        });
    } catch (err: unknown) {
      const errs = err as Record<string, string[]>;
      const msg =
        errs && typeof errs === "object" ? Object.values(errs).flat().join(" ") : "Could not create transaction.";
      setCreateError(msg || "Could not create transaction.");
    } finally {
      setBusy(false);
    }
  }

  async function ignore() {
    setBusy(true);
    try {
      const data = await jsonFetch<{ bank_transaction: BankTransaction }>(
        `/budgets/${budgetPk}/bank-transactions/${bankTxn.id}/ignore/`,
        "POST",
        {
          reason: ignoreReason.trim(),
        },
      );
      if (data) onResolved({ bankTxn: data.bank_transaction });
    } finally {
      setBusy(false);
    }
  }

  const amount = Number.parseFloat(bankTxn.amount);
  const negative = amount < 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Pending bank transaction</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-rule px-4 py-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <div className="font-medium">{bankTxn.payee || bankTxn.description || "—"}</div>
              <div className="text-ink-quiet text-sm">
                {bankTxn.org_name && <span>{bankTxn.org_name} · </span>}
                {bankTxn.bank_account_name} · {fmtDate(bankTxn.posted_date)}
              </div>
              {bankTxn.payee && bankTxn.description && bankTxn.payee !== bankTxn.description && (
                <div className="text-ink-quiet text-xs mt-1">{bankTxn.description}</div>
              )}
            </div>
            <div className={`text-xl font-semibold tabular-nums ${negative ? "text-expense" : "text-income"}`}>
              {fmtSigned(amount, symbol)}
            </div>
          </div>
        </div>

        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {ignoreMode && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="bt-ignore-reason">Reason (optional)</Label>
            <Input
              id="bt-ignore-reason"
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder="e.g. duplicate of #123 · refund · personal · not budgeted here"
              autoFocus
            />
            <p className="text-xs text-ink-quiet">
              This will move the transaction to the Ignored card. You can restore it later.
            </p>
          </div>
        )}

        {!createMode && !ignoreMode && (
          <div className="flex flex-col gap-2">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">Suggestions</div>
            {suggestions === null && !loadError && <div className="text-ink-quiet text-sm py-2">Finding matches…</div>}
            {suggestions && suggestions.length === 0 && (
              <div className="text-ink-quiet text-sm py-2">No matches found. Create a new transaction or ignore.</div>
            )}
            {suggestions?.map((s) => (
              <button
                key={`${s.kind}:${s.transaction_id ?? "-"}:${s.category_id ?? "-"}`}
                type="button"
                disabled={busy}
                onClick={() => void applySuggestion(s)}
                className="text-left rounded-md border border-rule px-3 py-2 hover:bg-muted/40 disabled:opacity-50"
              >
                <div className="flex justify-between items-center">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-ink-quiet text-xs">
                    {s.kind === "recurring"
                      ? "Recurring"
                      : s.kind === "merchant_rule"
                        ? "Suggested"
                        : s.kind === "paid_transaction"
                          ? "Already recorded"
                          : "Match"}
                    {" · "}
                    {Math.round(s.confidence * 100)}%
                  </div>
                </div>
                <div className="text-ink-quiet text-sm">{s.sublabel}</div>
              </button>
            ))}
          </div>
        )}

        {createMode && !ignoreMode && (
          <div className="flex flex-col gap-3">
            {createError && (
              <Alert variant="destructive">
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="bt-desc">Description</Label>
              <Input id="bt-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Label>Split across categories</Label>
                <span className="text-xs text-ink-quiet tabular-nums">
                  Total {fmt(linesTotal, symbol)} / {fmt(bankAmount, symbol)}
                  {!totalMatches && (
                    <span className="ml-2 text-destructive">
                      ({linesTotalDelta > 0 ? "over" : "remaining"}: {fmt(Math.abs(linesTotalDelta), symbol)})
                    </span>
                  )}
                </span>
              </div>

              {newLines.map((line, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled and addressed by index
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <Select value={line.category} onValueChange={(v) => updateLine(idx, { category: v })}>
                      <SelectTrigger size="sm" className="w-full" aria-label={`Split ${idx + 1} category`}>
                        <SelectValue placeholder="Pick a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Expense</SelectLabel>
                          {categories
                            .filter((c) => c.category_type === "expense" && !c.is_goal)
                            .map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Income</SelectLabel>
                          {categories
                            .filter((c) => c.category_type === "income" && !c.is_goal)
                            .map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                        {categories.some((c) => c.is_goal) && (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel>Goals</SelectLabel>
                              {categories
                                .filter((c) => c.is_goal)
                                .map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>
                                    <PiggyBank aria-hidden />
                                    {c.name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="col-span-3 tabular-nums"
                    type="number"
                    step="0.01"
                    min="0.01"
                    aria-label={`Split ${idx + 1} amount`}
                    value={line.amount}
                    onChange={(e) => updateLine(idx, { amount: e.target.value })}
                  />
                  <Input
                    className="col-span-2"
                    placeholder="Note"
                    aria-label={`Split ${idx + 1} note`}
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="col-span-1 justify-self-end"
                    onClick={() => removeLine(idx)}
                    disabled={newLines.length === 1}
                    aria-label="Remove split"
                    type="button"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}

              <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={addLine} type="button">
                <Plus className="size-3 mr-1" /> Add split
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          {ignoreMode ? (
            <>
              <Button variant="outline" onClick={() => setIgnoreMode(false)} disabled={busy}>
                Back
              </Button>
              <div className="flex-1" />
              <Button onClick={() => void ignore()} disabled={busy}>
                Ignore transaction
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setIgnoreMode(true)} disabled={busy}>
                Ignore
              </Button>
              <div className="flex-1" />
              {createMode ? (
                <>
                  <Button variant="outline" onClick={() => setCreateMode(false)} disabled={busy}>
                    Back
                  </Button>
                  <Button onClick={() => void createNew()} disabled={busy || !allLinesValid || !totalMatches}>
                    Create transaction
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setCreateMode(true)} disabled={busy}>
                  Create new transaction
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
