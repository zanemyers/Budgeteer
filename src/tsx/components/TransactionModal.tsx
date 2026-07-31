import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { jsonFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Category,
  CurrencyOption,
  LinkedBankTransaction,
  PaymentMethod,
  Transaction,
  TransactionLine,
} from "../types";
import { fmtSigned, useCurrencySymbol } from "../utils/currency";
import { fmtDate } from "../utils/date";

type CategoryWithGoal = Category & { is_goal?: boolean };

interface Props {
  categories: Category[];
  paymentMethods: PaymentMethod[];
  currencies: CurrencyOption[];
  userCurrency: string;
  budgetPk: number;
  onSave: (data: Partial<Transaction>) => Promise<void>;
  transaction?: Transaction | null;
  onClose: () => void;
  defaultCategoryType?: "income" | "expense";
  forceTransactionType?: "transfer";
  onIgnoreLinkedBankTxn?: (bt: LinkedBankTransaction) => Promise<void>;
  onTransactionUpdate?: (txn: Transaction) => void;
}

interface LineState {
  category: string;
  amount: string;
  description: string;
}

interface FormState {
  description: string;
  due_date: string;
  paid_date: string;
  budget_month: string;
  notes: string;
  payment_method: string;
  currency: string;
  lines: LineState[];
  categoryType: "income" | "expense";
}

function buildInitial(
  transaction: Transaction | null | undefined,
  defaultCategoryType: "income" | "expense" | undefined,
  categories: Category[],
  userCurrency: string,
): FormState {
  if (transaction) {
    return {
      description: transaction.description,
      due_date: transaction.due_date,
      paid_date: transaction.paid_date ?? "",
      budget_month: transaction.budget_month ? transaction.budget_month.slice(0, 7) : "",
      notes: transaction.notes,
      payment_method: transaction.payment_method ? String(transaction.payment_method) : "",
      currency: transaction.currency || userCurrency,
      lines: transaction.lines.map((l) => ({
        category: String(l.category),
        amount: l.amount,
        description: l.description,
      })),
      categoryType: transaction.transaction_type === "income" ? "income" : "expense",
    };
  }
  const resolvedType: "income" | "expense" = defaultCategoryType ?? "expense";
  const defaultCategory = String(categories.find((c) => c.category_type === resolvedType)?.id ?? "");
  return {
    description: "",
    due_date: new Date().toISOString().split("T")[0],
    paid_date: new Date().toISOString().split("T")[0],
    budget_month: "",
    notes: "",
    payment_method: "",
    currency: userCurrency,
    lines: [{ category: defaultCategory, amount: "", description: "" }],
    categoryType: resolvedType,
  };
}

export default function TransactionModal({
  categories,
  paymentMethods,
  currencies,
  userCurrency,
  budgetPk,
  onSave,
  transaction,
  onClose,
  defaultCategoryType,
  forceTransactionType,
  onIgnoreLinkedBankTxn,
  onTransactionUpdate,
}: Props) {
  const symbol = useCurrencySymbol();
  const [form, setForm] = useState<FormState>(() =>
    buildInitial(transaction, defaultCategoryType, categories, userCurrency),
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const partnerId = transaction?.transfer_partner_id ?? null;
  const [transferCandidates, setTransferCandidates] = useState<Transaction[] | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  async function loadTransferCandidates() {
    if (!transaction) return;
    setTransferBusy(true);
    try {
      const data = await jsonFetch<{ candidates: Transaction[] }>(
        `/budgets/${budgetPk}/transactions/${transaction.id}/transfer-candidates/`,
        "GET",
      );
      setTransferCandidates(data?.candidates ?? []);
    } catch (err) {
      toast.error((err as { error?: string })?.error ?? "Couldn't load transfer candidates.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function linkTransfer(partner: Transaction) {
    if (!transaction) return;
    setTransferBusy(true);
    try {
      const updated = await jsonFetch<Transaction>(
        `/budgets/${budgetPk}/transactions/${transaction.id}/transfer-link/`,
        "PATCH",
        { partner_id: partner.id },
      );
      toast.success(`Linked to "${partner.description}".`);
      if (updated) onTransactionUpdate?.(updated);
      setTransferCandidates(null);
    } catch (err) {
      toast.error((err as { error?: string })?.error ?? "Couldn't link transfer.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function unlinkTransfer() {
    if (!transaction) return;
    setTransferBusy(true);
    try {
      const updated = await jsonFetch<Transaction>(
        `/budgets/${budgetPk}/transactions/${transaction.id}/transfer-link/`,
        "PATCH",
        { partner_id: null },
      );
      toast.success("Transfer unlinked.");
      if (updated) onTransactionUpdate?.(updated);
    } catch {
      toast.error("Couldn't unlink.");
    } finally {
      setTransferBusy(false);
    }
  }

  useEffect(() => {
    setForm(buildInitial(transaction, defaultCategoryType, categories, userCurrency));
  }, [transaction, defaultCategoryType, categories, userCurrency]);

  const isEdit = Boolean(transaction);
  const isRecurring = Boolean(transaction?.recurring);
  const isForeignCurrency = form.currency !== userCurrency;
  const visibleCategories = (categories as CategoryWithGoal[]).filter(
    (c) => c.category_type === form.categoryType || c.is_goal,
  );
  const allLinesSF =
    form.lines.length > 0 &&
    form.lines.every((l) => {
      const cat = (categories as CategoryWithGoal[]).find((c) => String(c.id) === l.category);
      return cat?.is_goal === true;
    });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateLine(idx: number, field: keyof LineState, value: string) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
    }));
  }

  function addLine() {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, { category: "", amount: "", description: "" }],
    }));
  }

  function removeLine(idx: number) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== idx),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Partial<Transaction> = {
      description: form.description,
      due_date: form.due_date,
      paid_date: form.paid_date || null,
      notes: form.notes,
      transaction_type: forceTransactionType ?? form.categoryType,
      payment_method: form.payment_method ? parseInt(form.payment_method, 10) : null,
      currency: form.currency,
      lines: form.lines.map((l) => ({
        category: parseInt(l.category, 10),
        amount: l.amount,
        description: l.description,
      })) as TransactionLine[],
    };
    if ((forceTransactionType ?? form.categoryType) === "income") {
      // Empty leaves it to the pay schedule's default on the server.
      payload.budget_month = form.budget_month || null;
    }

    setSaving(true);
    setErrors({});
    try {
      await onSave(payload);
      onClose();
    } catch (err: unknown) {
      setErrors(err as Record<string, string[]>);
      setSaving(false);
    }
  }

  const title = isEdit
    ? "Edit Transaction"
    : forceTransactionType === "transfer"
      ? "Transfer to Goal"
      : form.categoryType === "income"
        ? "Add Income"
        : "Add Expense";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="py-4 flex flex-col gap-4">
            {errors.non_field_errors && (
              <Alert variant="destructive">
                <AlertDescription>{errors.non_field_errors.join(" ")}</AlertDescription>
              </Alert>
            )}

            {!isEdit && (
              <div className="flex w-full rounded-md overflow-hidden border border-border-strong">
                {(["expense", "income"] as const).map((t) => {
                  const active = form.categoryType === t;
                  const activeClass =
                    t === "expense"
                      ? "bg-destructive text-white"
                      : allLinesSF
                        ? "bg-amber-500 text-white"
                        : "bg-primary text-primary-foreground";
                  return (
                    <button
                      type="button"
                      key={t}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium transition-colors capitalize cursor-pointer",
                        active ? activeClass : "bg-card hover:bg-muted",
                      )}
                      onClick={() => {
                        update("categoryType", t);
                        update("lines", [{ category: "", amount: "", description: "" }]);
                      }}
                    >
                      {t === "income" && allLinesSF ? "Deposit" : t}
                    </button>
                  );
                })}
              </div>
            )}

            {transaction?.linked_bank_transactions && transaction.linked_bank_transactions.length > 0 && (
              <div className="rounded-md border border-rule bg-muted/30 px-3 py-2 flex flex-col gap-2">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                  Linked bank transaction{transaction.linked_bank_transactions.length === 1 ? "" : "s"}
                </div>
                {transaction.linked_bank_transactions.map((bt) => {
                  const amt = Number.parseFloat(bt.amount);
                  const negative = amt < 0;
                  return (
                    <div key={bt.id} className="flex justify-between items-start gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{bt.payee || bt.description || "—"}</div>
                        <div className="text-ink-quiet text-xs">
                          {bt.org_name && <span>{bt.org_name} · </span>}
                          {bt.bank_account_name} · {fmtDate(bt.posted_date)}
                        </div>
                        {bt.payee && bt.description && bt.payee !== bt.description && (
                          <div className="text-ink-quiet text-xs truncate">{bt.description}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className={`tabular-nums whitespace-nowrap ${negative ? "text-expense" : "text-income"}`}>
                          {fmtSigned(amt, symbol)}
                        </div>
                        {onIgnoreLinkedBankTxn && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-xs h-auto py-0.5 px-1.5 text-ink-quiet hover:text-ink"
                            onClick={() => void onIgnoreLinkedBankTxn(bt)}
                            title="Unlink and move this bank row to Ignored"
                          >
                            Ignore
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isEdit && (
              <div className="rounded-md border border-rule bg-muted/30 px-3 py-2 flex flex-col gap-2">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                  Transfer link
                </div>
                {partnerId !== null ? (
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="mr-2">
                        Linked
                      </Badge>
                      Paired with another transaction; both legs are excluded from headline income/expense totals.
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto py-0.5 px-1.5"
                      disabled={transferBusy}
                      onClick={() => void unlinkTransfer()}
                    >
                      Unlink
                    </Button>
                  </div>
                ) : transferCandidates === null ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-quiet">
                      For account-to-account moves (e.g. checking → savings), link the two legs so they don't
                      double-count.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={transferBusy}
                      onClick={() => void loadTransferCandidates()}
                    >
                      Find transfer partner
                    </Button>
                  </div>
                ) : transferCandidates.length === 0 ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="text-ink-quiet">
                      No matching transactions found (same amount, opposite direction, within ±3 days, different payment
                      method).
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto py-0.5 px-1.5"
                      onClick={() => setTransferCandidates(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-ink-quiet mb-2">Pick the matching counterpart:</p>
                    <ul className="divide-y border border-rule rounded bg-background">
                      {transferCandidates.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.description}</div>
                            <div className="text-xs text-ink-quiet">
                              {fmtDate(c.paid_date ?? c.due_date)} · {c.payment_method_name ?? "—"} ·{" "}
                              <span className="tabular-nums">
                                {fmtSigned(
                                  Number.parseFloat(c.total_amount) * (c.transaction_type === "expense" ? -1 : 1),
                                  symbol,
                                )}
                              </span>
                            </div>
                          </div>
                          <Button type="button" size="sm" disabled={transferBusy} onClick={() => void linkTransfer(c)}>
                            Link
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs h-auto py-0.5 px-1.5"
                        onClick={() => setTransferCandidates(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="txn-desc">Description</Label>
              <Input
                id="txn-desc"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                required
                aria-invalid={!!errors.description}
              />
              {errors.description && <p className="text-destructive text-sm">{errors.description.join(" ")}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {isRecurring && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="txn-due">Due Date</Label>
                  <Input
                    id="txn-due"
                    type="date"
                    value={form.due_date}
                    onChange={(e) => update("due_date", e.target.value)}
                    required
                    aria-invalid={!!errors.due_date}
                  />
                  {errors.due_date && <p className="text-destructive text-sm">{errors.due_date.join(" ")}</p>}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="txn-paid">{form.categoryType === "income" ? "Received Date" : "Paid Date"}</Label>
                <Input
                  id="txn-paid"
                  type="date"
                  value={form.paid_date}
                  onChange={(e) => update("paid_date", e.target.value)}
                />
              </div>
              {form.categoryType === "income" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="txn-budget-month">Funds budget month</Label>
                  <Input
                    id="txn-budget-month"
                    type="month"
                    value={form.budget_month}
                    onChange={(e) => update("budget_month", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Leave blank to use your pay schedule's default.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="txn-pm">Payment Method</Label>
                <Select
                  value={form.payment_method || "none"}
                  onValueChange={(v) => update("payment_method", v === "none" ? "" : v)}
                >
                  <SelectTrigger id="txn-pm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {paymentMethods
                      .filter((m) => m.is_active)
                      .map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name}
                          {m.last_four ? ` ···${m.last_four}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="txn-currency">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                  <SelectTrigger id="txn-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isForeignCurrency && (
                  <p className="text-muted-foreground text-sm">
                    Amounts will be converted from {form.currency} to {userCurrency}
                  </p>
                )}
              </div>
            </div>

            <hr className="border-border" />
            <h6 className="font-semibold">Line Items</h6>
            {errors.lines && (
              <Alert variant="destructive">
                <AlertDescription>{(errors.lines as unknown as string[]).join(" ")}</AlertDescription>
              </Alert>
            )}
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 md:col-span-5 flex flex-col gap-1.5">
                  <Label className="text-sm">Category</Label>
                  <Select value={line.category} onValueChange={(v) => updateLine(idx, "category", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="-- Select --" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const regular = visibleCategories.filter((c) => !(c as CategoryWithGoal).is_goal);
                        const goals = visibleCategories.filter((c) => (c as CategoryWithGoal).is_goal);
                        const groupLabel = form.categoryType === "income" ? "Income" : "Expense";
                        return (
                          <>
                            {regular.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>{groupLabel}</SelectLabel>
                                {regular.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {regular.length > 0 && goals.length > 0 && <SelectSeparator />}
                            {goals.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Goals</SelectLabel>
                                {goals.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>
                                    ◎ {c.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </>
                        );
                      })()}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-12 md:col-span-3 flex flex-col gap-1.5">
                  <Label className="text-sm">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={line.amount}
                    onChange={(e) => updateLine(idx, "amount", e.target.value)}
                    required
                  />
                </div>
                <div className="col-span-12 md:col-span-3 flex flex-col gap-1.5">
                  <Label className="text-sm">Note</Label>
                  <Input value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} />
                </div>
                <div className="col-span-12 md:col-span-1">
                  {form.lines.length > 1 && (
                    <Button type="button" variant="destructive-subtle" size="sm" onClick={() => removeLine(idx)}>
                      &times;
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={addLine}>
              + Add Line
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
