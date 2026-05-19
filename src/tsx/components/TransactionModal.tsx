import { useEffect, useState } from "react";
import type { Category, CurrencyOption, PaymentMethod, Transaction, TransactionLine } from "../types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

type CategoryWithSF = Category & { is_sinking_fund?: boolean };

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
  notes: string;
  payment_method: string;
  currency: string;
  lines: LineState[];
  categoryType: "income" | "expense";
}

function buildInitial(transaction: Transaction | null | undefined, defaultCategoryType: "income" | "expense" | undefined, categories: Category[], userCurrency: string): FormState {
  if (transaction) {
    return {
      description: transaction.description,
      due_date: transaction.due_date,
      paid_date: transaction.paid_date ?? "",
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
  onSave,
  transaction,
  onClose,
  defaultCategoryType,
}: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitial(transaction, defaultCategoryType, categories, userCurrency));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setForm(buildInitial(transaction, defaultCategoryType, categories, userCurrency));
  }, [transaction, defaultCategoryType, categories, userCurrency]);

  const isEdit = Boolean(transaction);
  const isRecurring = Boolean(transaction?.recurring);
  const isBankLinked = Boolean(transaction?.bank_linked);
  const isForeignCurrency = form.currency !== userCurrency;
  const visibleCategories = (categories as CategoryWithSF[]).filter(
    (c) => c.category_type === form.categoryType || c.is_sinking_fund
  );
  const allLinesSF = form.lines.length > 0 && form.lines.every((l) => {
    const cat = (categories as CategoryWithSF[]).find((c) => String(c.id) === l.category);
    return cat?.is_sinking_fund === true;
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateLine(idx: number, field: keyof LineState, value: string) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l),
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
      transaction_type: form.categoryType,
      payment_method: form.payment_method ? parseInt(form.payment_method, 10) : null,
      currency: form.currency,
      lines: form.lines.map((l) => ({
        category: parseInt(l.category, 10),
        amount: l.amount,
        description: l.description,
      })) as TransactionLine[],
    };

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
    : form.categoryType === "income"
      ? (allLinesSF ? "Deposit to Fund" : "Add Income")
      : "Add Expense";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
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
                  const activeClass = t === "expense"
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
                          {bt.bank_account_name} · {new Date(`${bt.posted_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                        {bt.payee && bt.description && bt.payee !== bt.description && (
                          <div className="text-ink-quiet text-xs truncate">{bt.description}</div>
                        )}
                      </div>
                      <div className={`tabular-nums whitespace-nowrap ${negative ? "text-expense" : "text-income"}`}>
                        {negative ? "−" : "+"}${Math.abs(amt).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
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
                  disabled={isBankLinked}
                  title={isBankLinked ? "Locked to the bank's posted date" : undefined}
                />
                {isBankLinked && (
                  <p className="text-xs text-ink-quiet">Locked to the bank's posted date.</p>
                )}
              </div>
            </div>

            {isRecurring && form.categoryType !== "income" && !isBankLinked && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="modal-is-paid"
                  checked={Boolean(form.paid_date)}
                  onCheckedChange={(c) => update("paid_date", c === true ? (form.paid_date || new Date().toISOString().split("T")[0]) : "")}
                />
                <Label htmlFor="modal-is-paid" className="font-normal">Mark as Paid</Label>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="txn-pm">Payment Method</Label>
                <Select
                  value={form.payment_method || "none"}
                  onValueChange={(v) => update("payment_method", v === "none" ? "" : v)}
                >
                  <SelectTrigger id="txn-pm" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {paymentMethods.filter((m) => m.is_active).map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}{m.last_four ? ` ···${m.last_four}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="txn-currency">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                  <SelectTrigger id="txn-currency" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isForeignCurrency && (
                  <p className="text-muted-foreground text-sm">Amounts will be converted from {form.currency} to {userCurrency}</p>
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
                  <Select
                    value={line.category}
                    onValueChange={(v) => updateLine(idx, "category", v)}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="-- Select --" /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const regular = visibleCategories.filter((c) => !(c as CategoryWithSF).is_sinking_fund);
                        const goals = visibleCategories.filter((c) => (c as CategoryWithSF).is_sinking_fund);
                        const groupLabel = form.categoryType === "income" ? "Income" : "Expense";
                        return (
                          <>
                            {regular.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>{groupLabel}</SelectLabel>
                                {regular.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {regular.length > 0 && goals.length > 0 && <SelectSeparator />}
                            {goals.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Goals (sinking funds)</SelectLabel>
                                {goals.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>◎ {c.name}</SelectItem>
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
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(idx, "description", e.target.value)}
                  />
                </div>
                <div className="col-span-12 md:col-span-1">
                  {form.lines.length > 1 && (
                    <Button
                      type="button"
                      variant="destructive-subtle"
                      size="sm"
                      onClick={() => removeLine(idx)}
                    >
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
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
