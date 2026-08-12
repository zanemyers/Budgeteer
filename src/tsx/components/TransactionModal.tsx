import { Check, PiggyBank } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { todayLocal } from "@/utils/date";
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
  onSave: (data: Partial<Transaction>) => Promise<void>;
  transaction?: Transaction | null;
  onClose: () => void;
  defaultCategoryType?: "income" | "expense";
  /** Goal deposits are written as transaction_type "transfer" — the last use of that value. */
  forceTransactionType?: "transfer";
  onIgnoreLinkedBankTxn?: (bt: LinkedBankTransaction) => Promise<void>;
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
    due_date: todayLocal(),
    paid_date: todayLocal(),
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
  onSave,
  transaction,
  onClose,
  defaultCategoryType,
  forceTransactionType,
  onIgnoreLinkedBankTxn,
}: Props) {
  const symbol = useCurrencySymbol();
  const [form, setForm] = useState<FormState>(() =>
    buildInitial(transaction, defaultCategoryType, categories, userCurrency),
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
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

  // Almost every transaction has exactly one line. That case gets category and amount as plain
  // top-level fields; the repeating "Line Items" editor only appears once you actually split.
  const isSingleLine = form.lines.length === 1;

  /**
   * The category picker for one line. Extracted because the single-line layout promotes it to a
   * top-level field while the split layout repeats it per row, and the option grouping is long
   * enough that two copies would drift.
   */
  function categoryField(idx: number, id?: string) {
    const regular = visibleCategories.filter((c) => !(c as CategoryWithGoal).is_goal);
    const goals = visibleCategories.filter((c) => (c as CategoryWithGoal).is_goal);
    const groupLabel = form.categoryType === "income" ? "Income" : "Expense";
    return (
      <Select value={form.lines[idx].category} onValueChange={(v) => updateLine(idx, "category", v)}>
        {/* A visible <Label htmlFor> names it in the single-line layout; the split rows have no
            per-row label, so they fall back to aria-label. */}
        <SelectTrigger id={id} className="w-full" aria-label={id ? undefined : `Line ${idx + 1} category`}>
          <SelectValue placeholder="-- Select --" />
        </SelectTrigger>
        <SelectContent>
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
                  <PiggyBank aria-hidden />
                  {c.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    );
  }

  const title = isEdit
    ? "Edit Transaction"
    : forceTransactionType === "transfer"
      ? "Deposit to Goal"
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
      {/* Radix focuses the first tabbable element on open, which is the description. That is right
          when adding — you are going to type it — and wrong when editing, where you opened the row
          to change one specific thing and the keyboard covering half the form is in the way. */}
      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={isEdit ? (e) => e.preventDefault() : undefined}>
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

            {/* A segmented control whose selection was expressed only as a background colour,
                on the one input that decides whether money is coming in or going out.
                aria-pressed states it; the check mark is the non-colour cue. */}
            {!isEdit && (
              <fieldset className="flex w-full min-w-0 rounded-md overflow-hidden border border-border-strong">
                {/* sr-only legend rather than aria-label on a div: a real fieldset/legend is
                    the semantic grouping, and the legend is clipped so layout is unaffected. */}
                <legend className="sr-only">Is this money going out or coming in?</legend>
                {(["expense", "income"] as const).map((t) => {
                  const active = form.categoryType === t;
                  // Each of these backgrounds is a saturated token that inverts between themes, so the
                  // label has to ride its paired -foreground rather than a literal white: --moss,
                  // --alarm and --fund all land near 72% lightness in dark mode, where white text
                  // measures 2.4:1, 2.8:1 and 2.3:1.
                  const activeClass =
                    t === "expense"
                      ? "bg-destructive text-destructive-foreground"
                      : allLinesSF
                        ? "bg-fund text-fund-foreground"
                        : "bg-primary text-primary-foreground";
                  return (
                    <button
                      type="button"
                      key={t}
                      aria-pressed={active}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium transition-colors capitalize cursor-pointer",
                        "inline-flex items-center justify-center gap-1.5",
                        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
                        active ? activeClass : "bg-card hover:bg-muted",
                      )}
                      onClick={() => {
                        update("categoryType", t);
                        update("lines", [{ category: "", amount: "", description: "" }]);
                      }}
                    >
                      {active && <Check aria-hidden className="size-3.5" />}
                      {t === "income" && allLinesSF ? "Deposit" : t}
                    </button>
                  );
                })}
              </fieldset>
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

            {/* One row, phone included — at 390px these are ~170px each, and keeping them on a line
                matches the split editor below rather than stacking the two most-used fields. */}
            {isSingleLine && (
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="txn-category">Category</Label>
                  {categoryField(0, "txn-category")}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="txn-amount">Amount</Label>
                  <Input
                    id="txn-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.lines[0].amount}
                    onChange={(e) => updateLine(0, "amount", e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

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
            </div>

            {errors.lines && (
              <Alert variant="destructive">
                <AlertDescription>{(errors.lines as unknown as string[]).join(" ")}</AlertDescription>
              </Alert>
            )}

            {!isSingleLine && (
              <>
                <hr className="border-border" />
                <h6 className="font-semibold">Line Items</h6>
                {form.lines.map((line, idx) => (
                  // Category, amount and the remove button on one line; the note gets the row under
                  // it. This was a 12-column grid with the remove button in `col-span-1` — about
                  // 27px at 390px for a button that will not go under 32px, so it pushed the whole
                  // grid wider than the dialog and the modal scrolled sideways. Flex instead: the
                  // button takes its natural width, the amount a fixed one, and the category picker
                  // absorbs whatever is left. The note earns a full row because it is free text and
                  // was the field with the least room.
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled and addressed by index
                  <div key={idx} className="flex flex-col gap-2">
                    <div className="flex items-end gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Label className="text-xs sm:text-sm">Category</Label>
                        {categoryField(idx)}
                      </div>
                      <div className="flex w-24 shrink-0 flex-col gap-1.5">
                        <Label className="text-xs sm:text-sm">Amount</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          aria-label={`Line ${idx + 1} amount`}
                          value={line.amount}
                          onChange={(e) => updateLine(idx, "amount", e.target.value)}
                          required
                        />
                      </div>
                      <Button
                        type="button"
                        variant="destructive-subtle"
                        size="icon-sm"
                        className="shrink-0"
                        aria-label={`Remove line ${idx + 1}`}
                        onClick={() => removeLine(idx)}
                      >
                        &times;
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs sm:text-sm">Note</Label>
                      <Input
                        aria-label={`Line ${idx + 1} note`}
                        value={line.description}
                        onChange={(e) => updateLine(idx, "description", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}

            <Button type="button" variant="outline" size="sm" className="self-start" onClick={addLine}>
              {isSingleLine ? "Split across categories" : "+ Add Line"}
            </Button>

            {/* Payment method and currency share a row — both are pickers holding a short value, and
                the currency trigger is reduced to its code so it fits. The note is not: it is free
                text that can run long, so it takes the row underneath rather than a third of this
                one. In a split the note belongs to each line instead, beneath that line's category
                and amount. */}
            <div className="grid grid-cols-2 gap-2 items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="txn-pm" className="text-xs sm:text-sm">
                  Payment
                </Label>
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="txn-currency" className="text-xs sm:text-sm">
                  Currency
                </Label>
                <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                  {/* Children on SelectValue override what the trigger shows, so the list keeps
                      "USD — US Dollar" while the closed trigger is just "USD". */}
                  <SelectTrigger id="txn-currency" className="w-full">
                    <SelectValue>{form.currency}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* A whole row of its own, under the two pickers. In a split each line carries its own
                note, so this one would be describing nothing. */}
            {isSingleLine && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="txn-note" className="text-xs sm:text-sm">
                  Note
                </Label>
                <Input
                  id="txn-note"
                  value={form.lines[0].description}
                  onChange={(e) => updateLine(0, "description", e.target.value)}
                />
              </div>
            )}

            {isForeignCurrency && (
              <p className="text-muted-foreground text-sm">
                Amounts will be converted from {form.currency} to {userCurrency}
              </p>
            )}

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
