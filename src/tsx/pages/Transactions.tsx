import { router } from "@inertiajs/react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Landmark,
  Pencil,
  PiggyBank,
  Search,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TransactionImportModal } from "@/components/TransactionImportModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BankTransactionConfirmModal from "../components/BankTransactionConfirmModal";
import { PageTourButton } from "../components/PageTourButton";
import TransactionModal from "../components/TransactionModal";
import { errorMessage, jsonFetch } from "../lib/api";
import { usePageTour } from "../lib/onboardingTour";
import type {
  BankTransaction,
  Category,
  CurrencyOption,
  LinkedBankTransaction,
  PaymentMethod,
  Transaction,
} from "../types";
import { fmt, fmtConverted, fmtSigned, useCurrencyCode, useCurrencyRate, useCurrencySymbol } from "../utils/currency";
import { fmtDate } from "../utils/date";
import { formatMonth, getDefaultMonth, isAtBackLimit, nextMonth, prevMonth } from "../utils/month";

/**
 * A bank payee runs long — "POS PURCHASE TERMINAL 4471 COMMERCE BANK" — and left whole it pushes the
 * row wide enough to shove the amount off a narrow screen. The full text stays in a title attribute.
 */
const DESCRIPTION_LIMIT = 25;

function truncate(text: string): string {
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT).trimEnd()}…` : text;
}

/** What a bulk action can do. Mirrors TransactionBulkView.ACTIONS on the server. */
type BulkAction = "delete" | "category" | "payment_method" | "mark_paid" | "mark_unpaid";

interface Props {
  budget_pk: number;
  month: string;
  category_filter: string;
  method_filter: string;
  date_from: string;
  search: string;
  date_to: string;
  transactions: Transaction[];
  bank_transactions?: BankTransaction[];
  ignored_bank_transactions?: BankTransaction[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  currencies: CurrencyOption[];
  user_currency: string;
}

type SortKey = "description" | "paid_date" | "category" | "amount" | "payment_method";
type SortDir = "asc" | "desc";
type SortEntry = { key: SortKey; dir: SortDir };

function getValue(txn: Transaction, key: SortKey): string | number {
  if (key === "description") return txn.description.toLowerCase();
  if (key === "paid_date") return txn.paid_date ?? "9999";
  if (key === "category") return (txn.lines[0]?.category_name ?? "").toLowerCase();
  if (key === "amount") return parseFloat(txn.total_amount);
  if (key === "payment_method") return (txn.payment_method_name ?? "").toLowerCase();
  return "";
}

function sortTransactions(txns: Transaction[], order: SortEntry[]): Transaction[] {
  if (order.length === 0) return txns;
  return [...txns].sort((a, b) => {
    for (const { key, dir } of order) {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

export default function Transactions({
  budget_pk,
  month,
  category_filter,
  method_filter,
  date_from,
  search,
  date_to,
  transactions: initialTxns,
  bank_transactions: initialBankTxns,
  ignored_bank_transactions: initialIgnoredBankTxns,
  categories,
  payment_methods,
  currencies,
  user_currency,
}: Props) {
  usePageTour("transactions", budget_pk);
  const symbol = useCurrencySymbol();
  const userRate = useCurrencyRate();
  const userCurrencyCode = useCurrencyCode();
  const [transactions, setTransactions] = useState(initialTxns);
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>(initialBankTxns ?? []);
  const [ignoredBankTxns, setIgnoredBankTxns] = useState<BankTransaction[]>(initialIgnoredBankTxns ?? []);
  const [bankTxnToConfirm, setBankTxnToConfirm] = useState<BankTransaction | null>(null);
  const [editReason, setEditReason] = useState<Record<number, string>>({});
  const [sortOrder, setSortOrder] = useState<SortEntry[]>([{ key: "paid_date", dir: "desc" }]);
  const [editDesc, setEditDesc] = useState<Record<number, string>>({});
  const [editDate, setEditDate] = useState<Record<number, string>>({});
  const [editPM, setEditPM] = useState<number | null>(null);
  const [addType, setAddType] = useState<"income" | "expense" | null>(null);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [markingPaid, setMarkingPaid] = useState<Set<number>>(new Set());

  const isCurrentMonth = month === getDefaultMonth();

  function handleSort(key: SortKey, shiftKey: boolean) {
    setSortOrder((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (shiftKey) {
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { key, dir: prev[idx].dir === "asc" ? "desc" : "asc" };
          return updated;
        }
        return [...prev, { key, dir: "asc" }];
      } else {
        if (idx === 0 && prev.length === 1) return [{ key, dir: prev[0].dir === "asc" ? "desc" : "asc" }];
        return [{ key, dir: idx === 0 ? (prev[0].dir === "asc" ? "desc" : "asc") : "asc" }];
      }
    });
  }

  function SortHeader({ label, sortKey: key, className }: { label: string; sortKey: SortKey; className?: string }) {
    const idx = sortOrder.findIndex((s) => s.key === key);
    const active = idx >= 0;
    const dir = active ? sortOrder[idx].dir : "asc";
    const rank = sortOrder.length > 1 && active ? idx + 1 : null;
    return (
      <TableHead className={`whitespace-nowrap ${className ?? ""}`}>
        <button
          type="button"
          className="inline-flex items-center gap-1 cursor-pointer select-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={(e) => handleSort(key, e.shiftKey)}
          title="Click to sort, shift+click to add a secondary sort"
        >
          {label}
          <span className={active ? "text-moss" : "text-muted-foreground"}>
            {dir === "desc" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          </span>
          {rank ? <span className="text-[0.65rem] text-muted-foreground">{rank}</span> : null}
        </button>
      </TableHead>
    );
  }

  function navigate(params: Record<string, string>) {
    router.get(`/budgets/${budget_pk}/transactions/`, params, { preserveState: false });
  }

  // Build the query for a filter change, carrying the other active filters forward.
  function withFilters(overrides: Record<string, string | null>) {
    const current: Record<string, string> = {
      month,
      ...(category_filter ? { category: category_filter } : {}),
      ...(method_filter ? { method: method_filter } : {}),
      ...(date_from ? { date_from } : {}),
      ...(date_to ? { date_to } : {}),
      ...(search ? { q: search } : {}),
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === "") delete current[key];
      else current[key] = value;
    }
    return current;
  }

  const hasFilters = Boolean(category_filter || method_filter || date_from || date_to || search);
  // Local so typing doesn't round-trip on every keystroke; submitted on Enter or the button.
  const [searchDraft, setSearchDraft] = useState(search);
  const [importing, setImporting] = useState(false);
  // Selection is per tab, cleared whenever the tab changes. A set that survived the switch would
  // let someone act on rows they can no longer see, which is the opposite of deliberate.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Bank rows select separately. They are not transactions yet, so what you can do to them differs —
  // delete, ignore, restore — and one shared set would offer actions that cannot apply to half of
  // what is ticked.
  const [selectedBank, setSelectedBank] = useState<Set<number>>(new Set());
  const [bankAction, setBankAction] = useState<"delete" | "ignore" | "restore" | null>(null);

  function toggleBank(id: number) {
    setSelectedBank((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Apply one action to everything selected.
   *
   * Always behind the confirm dialog, never straight off the action bar: the whole point is that a
   * change affecting twenty rows is deliberate, and the dialog is where the twenty are listed.
   */
  async function runBulk() {
    if (!bulkAction || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const body: Record<string, unknown> = { action: bulkAction, ids: [...selected] };
      if (bulkAction === "category") body.category = Number(bulkValue);
      if (bulkAction === "payment_method") {
        body.payment_method = bulkValue && bulkValue !== "none" ? Number(bulkValue) : null;
      }
      const res = (await jsonFetch(`/budgets/${budget_pk}/transactions/bulk/`, "POST", body)) as {
        changed: number;
        skipped: { id: number; reason: string }[];
      } | null;
      const changed = res?.changed ?? 0;
      const skipped = res?.skipped ?? [];
      toast.success(
        skipped.length > 0
          ? `${changed} updated. ${skipped.length} left alone: ${skipped[0].reason}.`
          : `${changed} updated.`,
      );
      setSelected(new Set());
      setBulkAction(null);
      setBulkValue("");
      // Re-fetch the current view discarding state, which is what `navigate` already does for every
      // filter change. The rows on screen come from local state seeded once from props, so the
      // partial reload this used to do refreshed the props and changed nothing visible: the action
      // had worked and looked exactly as though it had not.
      navigate(withFilters({}));
    } catch (err) {
      toast.error(errorMessage(err, "That change could not be applied."));
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedTxns = useMemo(() => transactions.filter((t) => selected.has(t.id)), [transactions, selected]);

  async function patchTxn(id: number, data: Record<string, unknown>) {
    const updated = (await jsonFetch(`/budgets/${budget_pk}/transactions/${id}/edit/`, "PATCH", data)) as Transaction;
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    return updated;
  }

  // Delegates to the shared helper: reading only `err.error` meant every field-validation
  // message from the server was discarded in favour of the generic fallback.
  function errMsg(err: unknown, fallback: string): string {
    return errorMessage(err, fallback);
  }

  async function saveDesc(txn: Transaction) {
    const val = editDesc[txn.id];
    setEditDesc((prev) => {
      const n = { ...prev };
      delete n[txn.id];
      return n;
    });
    if (val === undefined || val === txn.description) return;
    try {
      await patchTxn(txn.id, { description: val });
    } catch (err) {
      toast.error(errMsg(err, "Couldn't save description."));
    }
  }

  async function saveDate(txn: Transaction) {
    const val = editDate[txn.id];
    setEditDate((prev) => {
      const n = { ...prev };
      delete n[txn.id];
      return n;
    });
    if (val === undefined || val === (txn.paid_date ?? "")) return;
    try {
      await patchTxn(txn.id, { paid_date: val || null });
    } catch (err) {
      toast.error(errMsg(err, "Couldn't save date."));
    }
  }

  async function savePM(txn: Transaction, pmId: number | null) {
    setEditPM(null);
    try {
      await patchTxn(txn.id, { payment_method: pmId });
    } catch (err) {
      toast.error(errMsg(err, "Couldn't save payment method."));
    }
  }

  async function markPaid(txn: Transaction) {
    setMarkingPaid((prev) => new Set(prev).add(txn.id));
    try {
      const updated = (await jsonFetch(
        `/budgets/${budget_pk}/transactions/${txn.id}/mark-paid/`,
        "POST",
      )) as Transaction;
      setTransactions((prev) => prev.map((t) => (t.id === txn.id ? updated : t)));
    } catch (err) {
      toast.error(errMsg(err, "Couldn't mark paid."));
    } finally {
      setMarkingPaid((prev) => {
        const n = new Set(prev);
        n.delete(txn.id);
        return n;
      });
    }
  }

  async function createTransaction(data: Partial<Transaction>) {
    const txn = await jsonFetch<Transaction>(`/budgets/${budget_pk}/transactions/create/`, "POST", data);
    if (txn) setTransactions((prev) => [...prev, txn]);
  }

  async function updateTransaction(data: Partial<Transaction>) {
    if (!editTxn) return;
    const updated = await jsonFetch<Transaction>(
      `/budgets/${budget_pk}/transactions/${editTxn.id}/edit/`,
      "PATCH",
      data,
    );
    if (updated) setTransactions((prev) => prev.map((t) => (t.id === editTxn.id ? updated : t)));
  }

  async function restoreBankTxn(bt: BankTransaction) {
    try {
      const data = (await jsonFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/unlink/`, "POST")) as {
        bank_transaction: BankTransaction;
      };
      setIgnoredBankTxns((prev) => prev.filter((b) => b.id !== bt.id));
      setBankTxns((prev) => [data.bank_transaction, ...prev]);
    } catch (err) {
      toast.error(errMsg(err, "Couldn't restore bank transaction."));
    }
  }

  /**
   * Remove an imported row outright.
   *
   * Ignoring one would leave it in the Ignored tab for good, since nothing re-syncs it back into
   * relevance. Only offered for imported rows; the endpoint refuses a synced one.
   */
  /** Apply one action to every selected bank row. Reached only through the confirm dialog. */
  async function runBankBulk(action: "delete" | "ignore" | "restore") {
    if (selectedBank.size === 0) return;
    setBulkBusy(true);
    try {
      const res = (await jsonFetch(`/budgets/${budget_pk}/bank-transactions/bulk/`, "POST", {
        action,
        ids: [...selectedBank],
      })) as { changed: number; skipped: { id: number; reason: string }[] } | null;
      const skipped = res?.skipped ?? [];
      toast.success(
        skipped.length > 0
          ? `${res?.changed ?? 0} updated. ${skipped.length} left alone: ${skipped[0].reason}.`
          : `${res?.changed ?? 0} updated.`,
      );
      setSelectedBank(new Set());
      setBankAction(null);
      navigate(withFilters({}));
    } catch (err) {
      toast.error(errorMessage(err, "That change could not be applied."));
    } finally {
      setBulkBusy(false);
    }
  }

  async function ignoreBankTxn(bt: BankTransaction) {
    try {
      const data = (await jsonFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/ignore/`, "POST", {
        reason: "",
      })) as { bank_transaction: BankTransaction };
      setBankTxns((prev) => prev.filter((b) => b.id !== bt.id));
      setIgnoredBankTxns((prev) => [data.bank_transaction, ...prev]);
    } catch (err) {
      toast.error(errMsg(err, "Couldn't ignore bank transaction."));
    }
  }

  async function ignoreLinkedBankTxn(bt: LinkedBankTransaction) {
    try {
      const data = (await jsonFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/ignore/`, "POST", {
        reason: "",
      })) as { bank_transaction: BankTransaction };
      setTransactions((prev) =>
        prev.map((t) => {
          if (!t.linked_bank_transactions?.some((b) => b.id === bt.id)) return t;
          const remaining = t.linked_bank_transactions.filter((b) => b.id !== bt.id);
          return { ...t, linked_bank_transactions: remaining, bank_linked: remaining.length > 0 };
        }),
      );
      setIgnoredBankTxns((prev) => [data.bank_transaction, ...prev]);
      setEditTxn(null);
    } catch (err) {
      toast.error(errMsg(err, "Couldn't ignore bank transaction."));
    }
  }

  async function saveIgnoreReason(bt: BankTransaction, reason: string) {
    if ((bt.ignore_reason ?? "") === reason.trim()) return;
    try {
      const data = (await jsonFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/ignore/`, "POST", {
        reason: reason.trim(),
      })) as { bank_transaction: BankTransaction };
      setIgnoredBankTxns((prev) => prev.map((b) => (b.id === bt.id ? data.bank_transaction : b)));
    } catch (err) {
      toast.error(errMsg(err, "Couldn't save ignore reason."));
    }
  }

  function renderRow(txn: Transaction, opts: { suppressStateMarkers?: boolean; includeDueColumn?: boolean } = {}) {
    const isSplit = txn.lines.length > 1;
    const isExpanded = expandedId === txn.id;
    const primaryCategory = txn.lines[0];
    const isEditingDesc = txn.id in editDesc;
    const isEditingDate = txn.id in editDate;
    const isEditingPM = editPM === txn.id;
    const isMarking = markingPaid.has(txn.id);
    const pmName = txn.payment_method_name;
    const isExpense = txn.transaction_type === "expense";
    const isIncome = txn.transaction_type === "income";
    const isTransfer = txn.transaction_type === "transfer";
    const amountClass = isIncome ? "text-income" : isTransfer ? "text-fund" : "text-expense";

    return (
      <Fragment key={txn.id}>
        <TableRow className={`group ${txn.is_paid ? "text-muted-foreground" : ""}`}>
          <TableCell className="w-8">
            <Checkbox
              checked={selected.has(txn.id)}
              onCheckedChange={() => toggleSelected(txn.id)}
              aria-label={`Select ${txn.description}`}
            />
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2 flex-wrap">
              {isEditingDesc ? (
                <Input
                  className="h-8 max-w-xs"
                  value={editDesc[txn.id]}
                  autoFocus
                  onChange={(e) => setEditDesc((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                  onBlur={() => void saveDesc(txn)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveDesc(txn);
                    if (e.key === "Escape")
                      setEditDesc((prev) => {
                        const n = { ...prev };
                        delete n[txn.id];
                        return n;
                      });
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="text-left rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 hover:underline"
                  onClick={() => setEditDesc((prev) => ({ ...prev, [txn.id]: txn.description }))}
                  title={txn.description.length > DESCRIPTION_LIMIT ? txn.description : undefined}
                >
                  {truncate(txn.description)}
                </button>
              )}
              {!opts.suppressStateMarkers && txn.recurring !== null && (
                <span className="text-xs italic text-ink-quiet">recurring</span>
              )}
              {txn.bank_linked && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-ink-quiet"
                  title="Linked to a bank transaction"
                >
                  <Landmark aria-hidden className="size-3" />
                  bank
                </span>
              )}
              {!opts.suppressStateMarkers && !txn.is_paid && !isTransfer && (
                <span className="text-xs italic text-fund">{isIncome ? "pending" : "unpaid"}</span>
              )}
              {isTransfer && <Badge variant="warning">Transfer</Badge>}
              {isSplit && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-ink rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  onClick={() => setExpandedId(isExpanded ? null : txn.id)}
                >
                  {isExpanded ? "Hide" : `${txn.lines.length} items`}
                </button>
              )}
            </div>
            {/* Stands in for the Category and Method columns, which are hidden below md. */}
            <div className="md:hidden mt-1 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>{isSplit ? "Split" : (primaryCategory?.category_name ?? "—")}</span>
              {txn.payment_method_name && (
                <>
                  <span aria-hidden>·</span>
                  <span>{txn.payment_method_name}</span>
                </>
              )}
            </div>
          </TableCell>

          {opts.includeDueColumn && (
            <TableCell>
              {txn.recurring !== null ? (
                <span className="text-fund tabular-nums">{fmtDate(txn.due_date)}</span>
              ) : (
                <span className="text-muted-foreground italic">N/A</span>
              )}
            </TableCell>
          )}

          <TableCell>
            {isEditingDate ? (
              <Input
                className="h-8"
                type="date"
                value={editDate[txn.id]}
                autoFocus
                onChange={(e) => setEditDate((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                onBlur={() => void saveDate(txn)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveDate(txn);
                  if (e.key === "Escape")
                    setEditDate((prev) => {
                      const n = { ...prev };
                      delete n[txn.id];
                      return n;
                    });
                }}
              />
            ) : (
              <button
                type="button"
                className="text-left rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 hover:underline tabular-nums"
                onClick={() => setEditDate((prev) => ({ ...prev, [txn.id]: txn.paid_date ?? "" }))}
              >
                {fmtDate(txn.paid_date)}
              </button>
            )}
          </TableCell>

          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
            {isSplit ? <span className="italic">Split</span> : primaryCategory ? primaryCategory.category_name : "—"}
          </TableCell>

          <TableCell className={`text-right font-medium tabular-nums ${amountClass}`}>
            {/* No role="img" here: it makes the element a leaf in the accessibility tree and
                lets aria-label replace its contents, so the amount itself never gets read.
                The visible +/− prefix carries the direction; the sr-only word names the type
                without hiding the number. */}
            <span>
              {isExpense ? "−" : isIncome ? "+" : ""}
              {fmtConverted(txn.total_amount, txn.exchange_rate_to_usd, userRate, symbol)}
              <span className="sr-only">{isIncome ? " income" : isTransfer ? " transfer" : " expense"}</span>
            </span>
            {txn.currency !== userCurrencyCode && (
              <div className="text-muted-foreground font-normal text-[0.7rem]">
                {fmt(txn.total_amount)} {txn.currency}
              </div>
            )}
          </TableCell>

          <TableCell className="hidden md:table-cell">
            {isEditingPM ? (
              <Select
                defaultValue={txn.payment_method ? String(txn.payment_method) : "none"}
                onValueChange={(v) => void savePM(txn, v === "none" ? null : Number(v))}
                onOpenChange={(open) => {
                  if (!open) setEditPM(null);
                }}
                open
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {payment_methods.map((pm) => (
                    <SelectItem key={pm.id} value={String(pm.id)}>
                      {pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <button
                type="button"
                className="text-sm text-muted-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 hover:underline"
                onClick={() => setEditPM(txn.id)}
              >
                {pmName ?? <span className="italic">—</span>}
              </button>
            )}
          </TableCell>

          <TableCell className="text-right whitespace-nowrap">
            <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isMarking}
                onClick={() => void markPaid(txn)}
                aria-label={
                  isMarking
                    ? "Updating"
                    : txn.is_paid
                      ? "Mark unpaid"
                      : isIncome
                        ? "Mark received"
                        : isTransfer
                          ? "Confirm transfer"
                          : "Mark paid"
                }
                title={
                  txn.is_paid
                    ? "Mark unpaid"
                    : isIncome
                      ? "Mark received"
                      : isTransfer
                        ? "Confirm transfer"
                        : "Mark paid"
                }
              >
                {txn.is_paid ? <Undo2 /> : <Check />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditTxn(txn)} aria-label="Edit transaction">
                <Pencil />
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && (
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableCell colSpan={opts.includeDueColumn ? 7 : 6} className="px-6 py-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txn.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.category_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtConverted(line.amount, txn.exchange_rate_to_usd, userRate, symbol)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{line.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  }

  const pending = useMemo(
    () => transactions.filter((t) => !t.paid_date).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [transactions],
  );
  const rest = useMemo(() => transactions.filter((t) => Boolean(t.paid_date) && !t.is_transfer), [transactions]);
  const transfers = useMemo(() => transactions.filter((t) => Boolean(t.paid_date) && t.is_transfer), [transactions]);
  const sortedRest = useMemo(() => sortTransactions(rest, sortOrder), [rest, sortOrder]);
  const sortedTransfers = useMemo(() => sortTransactions(transfers, sortOrder), [transfers, sortOrder]);

  return (
    <div className="max-w-[1200px]">
      {/* Page header */}
      <header className="mb-6 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-3" data-tour="month-nav">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isAtBackLimit(month)}
            onClick={() => navigate(withFilters({ month: prevMonth(month), date_from: null, date_to: null }))}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">{formatMonth(month)}</h1>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isCurrentMonth}
            onClick={() => navigate(withFilters({ month: nextMonth(month), date_from: null, date_to: null }))}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <PageTourButton stage="transactions" />
          {/* Exports exactly what the filters and search have narrowed to, one row per line, in
              the shape another budgeting app will accept. A plain link, so the browser handles the
              download and the file is never held in memory here. */}
          <Button asChild variant="outline" size="sm">
            <a
              href={`/budgets/${budget_pk}/transactions/export/?${new URLSearchParams(withFilters({})).toString()}`}
              download
            >
              <Download aria-hidden className="size-4" />
              Export {hasFilters ? "these rows" : "this list"}
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <Upload aria-hidden className="size-4" />
            Import
          </Button>
          <Button data-tour="txn-add" onClick={() => setAddType("expense")}>
            + Add Transaction
          </Button>
        </div>
      </header>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        <div className="relative">
          <Search aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-ink-quiet" />
          <Input
            type="search"
            aria-label="Search transactions by description"
            placeholder="Search all months"
            className="h-8 w-[220px] pl-8 pr-8"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate(withFilters({ q: searchDraft.trim() || null }));
              if (e.key === "Escape") {
                setSearchDraft("");
                if (search) navigate(withFilters({ q: null }));
              }
            }}
          />
          {searchDraft && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-ink-quiet hover:text-ink"
              onClick={() => {
                setSearchDraft("");
                if (search) navigate(withFilters({ q: null }));
              }}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet mr-1">Filter</span>
        <Select
          value={category_filter || "all"}
          onValueChange={(v) => navigate(withFilters({ category: v === "all" ? null : v }))}
        >
          <SelectTrigger size="sm" className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
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
            )}
          </SelectContent>
        </Select>
        <Select
          value={method_filter || "all"}
          onValueChange={(v) => navigate(withFilters({ method: v === "all" ? null : v }))}
        >
          <SelectTrigger size="sm" className="min-w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {payment_methods.map((pm) => (
              <SelectItem key={pm.id} value={String(pm.id)}>
                {pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter
          month={month}
          from={date_from}
          to={date_to}
          onChange={(f, t) => navigate(withFilters({ date_from: f || null, date_to: t || null }))}
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => navigate({ month })}>
            Clear
          </Button>
        )}
      </div>

      {/* The heading still shows a month because the bank panes below stay scoped to it, but the
          logged list does not while a search is running. Saying so beats letting the month label
          imply a narrower result set than you are looking at. */}
      {search && (
        <p className="-mt-3 mb-6 text-sm text-ink-quiet">
          Showing logged transactions from every month that match <span className="text-ink">{search}</span>. Awaiting
          review stays on {formatMonth(month)}.
        </p>
      )}

      {transactions.length === 0 && bankTxns.length === 0 && ignoredBankTxns.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            {search ? `No transactions match ${search}.` : "Nothing logged for this period."}
          </CardContent>
        </Card>
      ) : (
        (() => {
          const pendingCount = pending.length + bankTxns.length;
          const ignoredCount = ignoredBankTxns.length;
          const defaultTab = pendingCount > 0 ? "pending" : "logged";
          return (
            <Tabs
              value={activeTab ?? defaultTab}
              onValueChange={(v) => {
                setActiveTab(v);
                // Per tab: a selection that survived the switch would let someone act on rows they
                // can no longer see.
                setSelected(new Set());
              }}
              className="gap-4"
            >
              <TabsList data-tour="txn-tabs">
                <TabsTrigger value="pending" disabled={pendingCount === 0}>
                  Pending {pendingCount > 0 && `(${pendingCount})`}
                </TabsTrigger>
                <TabsTrigger value="logged">Logged ({rest.length})</TabsTrigger>
                <TabsTrigger value="transfers" disabled={transfers.length === 0}>
                  Transfers {transfers.length > 0 && `(${transfers.length})`}
                </TabsTrigger>
                <TabsTrigger value="ignored" disabled={ignoredCount === 0}>
                  Ignored {ignoredCount > 0 && `(${ignoredCount})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending">
                <Card className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            {/* This tab lists two kinds of row — unpaid transactions and bank rows
                                awaiting review — so select-all has to cover both. Keyed only to
                                transactions it did nothing whenever the tab held only bank rows,
                                which is the usual state right after an import. */}
                            <Checkbox
                              checked={
                                pending.length + bankTxns.length > 0 &&
                                pending.every((t) => selected.has(t.id)) &&
                                bankTxns.every((b) => selectedBank.has(b.id))
                              }
                              onCheckedChange={(checked) => {
                                setSelected(checked === true ? new Set(pending.map((t) => t.id)) : new Set());
                                setSelectedBank(checked === true ? new Set(bankTxns.map((b) => b.id)) : new Set());
                              }}
                              aria-label="Select every row in this tab"
                            />
                          </TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead className="hidden md:table-cell">Category</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="hidden md:table-cell">Method</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bankTxns.map((bt) => {
                          const amt = Number.parseFloat(bt.amount);
                          const negative = amt < 0;
                          const sourceLabel = bt.org_name || bt.bank_account_name;
                          return (
                            <TableRow key={`bt-${bt.id}`} className="group">
                              <TableCell className="w-8">
                                <Checkbox
                                  checked={selectedBank.has(bt.id)}
                                  onCheckedChange={() => toggleBank(bt.id)}
                                  aria-label={`Select ${bt.payee || bt.description}`}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{bt.payee || bt.description || "—"}</span>
                                    <span
                                      className="inline-flex items-center gap-1 text-xs text-ink-quiet"
                                      title={`From ${sourceLabel}`}
                                    >
                                      <Landmark aria-hidden className="size-3" />
                                      bank
                                    </span>
                                  </div>
                                  <span className="text-xs text-ink-quiet">
                                    {sourceLabel}
                                    {bt.payee && bt.description && bt.payee !== bt.description
                                      ? ` · ${bt.description}`
                                      : ""}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="tabular-nums">{fmtDate(bt.posted_date)}</TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground italic">
                                Unassigned
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                              >
                                {fmtSigned(amt, symbol)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <span className="text-muted-foreground italic">—</span>
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setBankTxnToConfirm(bt)}
                                    aria-label="Confirm bank transaction"
                                    title="Confirm and add to budget"
                                  >
                                    <Check />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void ignoreBankTxn(bt)}
                                    aria-label="Ignore bank transaction"
                                    title="Ignore — already recorded in budget"
                                  >
                                    <Archive />
                                  </Button>
                                  {/* Delete is offered only for an imported row. A synced one would
                                      come back on the next sync, which is what Ignore is for. */}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {pending.map((txn) => renderRow(txn, { suppressStateMarkers: true }))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="ignored">
                <Card className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            <Checkbox
                              checked={
                                ignoredBankTxns.length > 0 && ignoredBankTxns.every((b) => selectedBank.has(b.id))
                              }
                              onCheckedChange={(checked) =>
                                setSelectedBank(
                                  checked === true ? new Set(ignoredBankTxns.map((b) => b.id)) : new Set(),
                                )
                              }
                              aria-label="Select every ignored row"
                            />
                          </TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead className="hidden md:table-cell">Category</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ignoredBankTxns.map((bt) => {
                          const amt = Number.parseFloat(bt.amount);
                          const negative = amt < 0;
                          const sourceLabel = bt.org_name || bt.bank_account_name;
                          return (
                            <TableRow key={`ig-${bt.id}`} className="group text-muted-foreground">
                              <TableCell className="w-8">
                                <Checkbox
                                  checked={selectedBank.has(bt.id)}
                                  onCheckedChange={() => toggleBank(bt.id)}
                                  aria-label={`Select ${bt.payee || bt.description}`}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{bt.payee || bt.description || "—"}</span>
                                    <span
                                      className="inline-flex items-center gap-1 text-xs"
                                      title={`From ${sourceLabel}`}
                                    >
                                      <Landmark aria-hidden className="size-3" />
                                      bank
                                    </span>
                                  </div>
                                  <span className="text-xs">
                                    {sourceLabel}
                                    {bt.payee && bt.description && bt.payee !== bt.description
                                      ? ` · ${bt.description}`
                                      : ""}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="tabular-nums">{fmtDate(bt.posted_date)}</TableCell>
                              <TableCell className="hidden md:table-cell text-sm italic">Ignored</TableCell>
                              <TableCell className="max-w-[220px]">
                                {bt.id in editReason ? (
                                  <Input
                                    className="h-8 text-sm"
                                    autoFocus
                                    value={editReason[bt.id]}
                                    placeholder="Reason"
                                    onChange={(e) => setEditReason((prev) => ({ ...prev, [bt.id]: e.target.value }))}
                                    onBlur={() => {
                                      const val = editReason[bt.id];
                                      setEditReason((prev) => {
                                        const n = { ...prev };
                                        delete n[bt.id];
                                        return n;
                                      });
                                      void saveIgnoreReason(bt, val ?? "");
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape") {
                                        setEditReason((prev) => {
                                          const n = { ...prev };
                                          delete n[bt.id];
                                          return n;
                                        });
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="block w-full text-left truncate text-sm italic rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                                    title={bt.ignore_reason || "Click to add a reason"}
                                    onClick={() =>
                                      setEditReason((prev) => ({ ...prev, [bt.id]: bt.ignore_reason ?? "" }))
                                    }
                                  >
                                    {bt.ignore_reason || <span className="not-italic">—</span>}
                                  </button>
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                              >
                                {fmtSigned(amt, symbol)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void restoreBankTxn(bt)}
                                    aria-label="Restore to pending"
                                    title="Restore to pending"
                                  >
                                    <Undo2 />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="logged">
                <Card className="overflow-hidden p-0">
                  {rest.length === 0 ? (
                    <CardContent className="text-muted-foreground py-12 text-center">
                      Nothing recorded yet for this period.
                    </CardContent>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">
                              <Checkbox
                                checked={sortedRest.length > 0 && sortedRest.every((t) => selected.has(t.id))}
                                onCheckedChange={(checked) =>
                                  setSelected(checked === true ? new Set(sortedRest.map((t) => t.id)) : new Set())
                                }
                                aria-label="Select every row in this tab"
                              />
                            </TableHead>
                            <SortHeader label="Description" sortKey="description" />
                            <SortHeader label="Date" sortKey="paid_date" />
                            <SortHeader label="Category" sortKey="category" />
                            <SortHeader label="Amount" sortKey="amount" className="text-right" />
                            <SortHeader label="Method" sortKey="payment_method" />
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>{sortedRest.map((txn) => renderRow(txn))}</TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="transfers">
                <Card className="overflow-hidden p-0">
                  {transfers.length === 0 ? (
                    <CardContent className="text-muted-foreground py-12 text-center">
                      No linked transfers yet. Link two halves of a money movement (e.g. checking → savings) from a
                      transaction's edit modal to see them here.
                    </CardContent>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">
                              <Checkbox
                                checked={sortedTransfers.length > 0 && sortedTransfers.every((t) => selected.has(t.id))}
                                onCheckedChange={(checked) =>
                                  setSelected(checked === true ? new Set(sortedTransfers.map((t) => t.id)) : new Set())
                                }
                                aria-label="Select every row in this tab"
                              />
                            </TableHead>
                            <SortHeader label="Description" sortKey="description" />
                            <SortHeader label="Date" sortKey="paid_date" />
                            <SortHeader label="Category" sortKey="category" />
                            <SortHeader label="Amount" sortKey="amount" className="text-right" />
                            <SortHeader label="Method" sortKey="payment_method" />
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>{sortedTransfers.map((txn) => renderRow(txn))}</TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          );
        })()
      )}

      {/* Selection bar and its confirm step.

          Nothing here acts on a click. Every action opens the dialog below, which lists the rows it
          would touch, because a change affecting twenty rows should be something you agreed to
          rather than something you triggered. */}
      {/* Bank rows have their own bar: they are not transactions, so recategorising or marking them
          paid means nothing until they have been confirmed into one. */}
      {selectedBank.size > 0 && (
        <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-card p-3 shadow-lg">
          <span className="text-sm font-medium">{selectedBank.size} bank rows selected</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setBankAction("ignore")}>
            Ignore
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBankAction("restore")}>
            Restore to pending
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBankAction("delete")}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedBank(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {bankAction && (
        <Dialog open onOpenChange={(open) => !open && setBankAction(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {bankAction === "delete" && `Delete ${selectedBank.size} bank rows?`}
                {bankAction === "ignore" && `Ignore ${selectedBank.size} bank rows?`}
                {bankAction === "restore" && `Restore ${selectedBank.size} to pending?`}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="max-h-64 overflow-y-auto rounded-md border border-border-strong">
                <table className="w-full text-xs">
                  <tbody>
                    {[...bankTxns, ...ignoredBankTxns]
                      .filter((bt) => selectedBank.has(bt.id))
                      .map((bt) => (
                        <tr key={bt.id} className="border-t first:border-t-0">
                          <td className="px-2 py-1 tabular-nums text-ink-quiet">{bt.posted_date}</td>
                          <td className="px-2 py-1" title={bt.payee || bt.description}>
                            {truncate(bt.payee || bt.description || "—")}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmt(bt.amount, symbol)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {bankAction === "delete" && (
                <p className="text-xs text-alarm">
                  This cannot be undone. A row that came from a bank sync is left alone, since the next sync would bring
                  it straight back.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBankAction(null)} disabled={bulkBusy}>
                Cancel
              </Button>
              <Button
                variant={bankAction === "delete" ? "destructive" : "default"}
                onClick={() => void runBankBulk(bankAction)}
                disabled={bulkBusy}
              >
                {bulkBusy ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-card p-3 shadow-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setBulkAction("category")}>
            Recategorise
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("payment_method")}>
            Set method
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("mark_paid")}>
            Mark paid
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("mark_unpaid")}>
            Mark pending
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkAction("delete")}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {bulkAction && (
        <Dialog open onOpenChange={(open) => !open && setBulkAction(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {bulkAction === "delete" && `Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}?`}
                {bulkAction === "category" && "Move these to a category"}
                {bulkAction === "payment_method" && "Set the payment method on these"}
                {bulkAction === "mark_paid" && `Mark ${selected.size} as paid?`}
                {bulkAction === "mark_unpaid" && `Mark ${selected.size} as pending?`}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              {bulkAction === "category" && (
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger aria-label="Category to move these to">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) => !c.is_goal)
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}

              {bulkAction === "payment_method" && (
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger aria-label="Payment method to set">
                    <SelectValue placeholder="Choose a method" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Radix throws on an empty value, so "none" stands in and is mapped back to
                        null when the request is built. */}
                    <SelectItem value="none">No method</SelectItem>
                    {payment_methods.map((pm) => (
                      <SelectItem key={pm.id} value={String(pm.id)}>
                        {pm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* The list is the point. A count alone would let someone confirm a change to rows they
                  had forgotten were selected, which is how a bulk action does damage. */}
              <div className="max-h-64 overflow-y-auto rounded-md border border-border-strong">
                <table className="w-full text-xs">
                  <tbody>
                    {selectedTxns.map((txn) => (
                      <tr key={txn.id} className="border-t first:border-t-0">
                        <td className="px-2 py-1 tabular-nums text-ink-quiet">{txn.paid_date ?? txn.due_date}</td>
                        <td className="px-2 py-1" title={txn.description}>
                          {truncate(txn.description)}
                        </td>
                        <td className="px-2 py-1">
                          {txn.lines.length > 1 ? (
                            <span className="text-ink-quiet italic">split, will be left alone</span>
                          ) : (
                            (txn.lines[0]?.category_name ?? "")
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(txn.total_amount, symbol)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bulkAction === "category" && selectedTxns.some((t) => t.lines.length > 1) && (
                <p className="text-xs text-ink-quiet">
                  A split transaction is spread across several categories, so moving it would mean choosing which part
                  to discard. Those are left as they are.
                </p>
              )}
              {bulkAction === "delete" && (
                <p className="text-xs text-alarm">This cannot be undone. A transfer takes its matching side with it.</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkAction(null)} disabled={bulkBusy}>
                Cancel
              </Button>
              <Button
                variant={bulkAction === "delete" ? "destructive" : "default"}
                onClick={() => void runBulk()}
                disabled={bulkBusy || (bulkAction === "category" && !bulkValue)}
              >
                {bulkBusy ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {importing && (
        <TransactionImportModal
          budgetPk={budget_pk}
          paymentMethods={payment_methods}
          onClose={() => setImporting(false)}
          // A reload rather than a local splice: imported rows arrive as bank transactions awaiting
          // review, and some may have been logged outright, so both panes change at once.
          onImported={() => router.reload({ only: ["transactions", "bank_transactions"] })}
        />
      )}

      {/* Add / Edit Transaction Modal */}
      {(addType !== null || editTxn !== null) && (
        <TransactionModal
          categories={categories}
          paymentMethods={payment_methods}
          currencies={currencies}
          userCurrency={user_currency}
          budgetPk={budget_pk}
          transaction={editTxn}
          defaultCategoryType={editTxn ? undefined : (addType ?? undefined)}
          onSave={editTxn ? updateTransaction : createTransaction}
          onClose={() => {
            setAddType(null);
            setEditTxn(null);
          }}
          onIgnoreLinkedBankTxn={ignoreLinkedBankTxn}
          onTransactionUpdate={(t) => {
            setTransactions((prev) => prev.map((x) => (x.id === t.id ? t : x)));
            setEditTxn(t);
          }}
        />
      )}

      {bankTxnToConfirm && (
        <BankTransactionConfirmModal
          bankTxn={bankTxnToConfirm}
          budgetPk={budget_pk}
          categories={categories}
          onResolved={({ bankTxn, transaction, transferCandidates, partnerBankTxn, partner }) => {
            const removeIds = new Set<number>([bankTxn.id]);
            if (partnerBankTxn) removeIds.add(partnerBankTxn.id);
            setBankTxns((prev) => prev.filter((b) => !removeIds.has(b.id)));
            const upsertTxn = (list: Transaction[], t: Transaction) => {
              const existing = list.find((x) => x.id === t.id);
              return existing ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t];
            };
            if (transaction || partner) {
              setTransactions((prev) => {
                let next = prev;
                if (transaction) next = upsertTxn(next, transaction);
                if (partner) next = upsertTxn(next, partner);
                return next;
              });
            }
            if (transaction) {
              if (transferCandidates && transferCandidates.length === 1) {
                const suggested = transferCandidates[0];
                toast("Looks like a transfer", {
                  description: `Pair with "${suggested.description}"?`,
                  action: {
                    label: "Link",
                    onClick: async () => {
                      try {
                        const updated = await jsonFetch<Transaction>(
                          `/budgets/${budget_pk}/transactions/${transaction.id}/transfer-link/`,
                          "PATCH",
                          { partner_id: suggested.id },
                        );
                        if (updated) {
                          setTransactions((prev) =>
                            prev.map((t) =>
                              t.id === updated.id
                                ? updated
                                : t.id === suggested.id
                                  ? { ...t, transfer_partner_id: updated.id }
                                  : t,
                            ),
                          );
                          toast.success(`Linked to "${suggested.description}".`);
                        }
                      } catch (err) {
                        toast.error((err as { error?: string })?.error ?? "Couldn't link transfer.");
                      }
                    },
                  },
                  duration: 8000,
                });
              } else if (transferCandidates && transferCandidates.length > 1) {
                toast(`${transferCandidates.length} possible transfer partners`, {
                  description: "Open the transaction to pick one.",
                  duration: 6000,
                });
              }
            }
            setBankTxnToConfirm(null);
          }}
          onClose={() => setBankTxnToConfirm(null)}
        />
      )}
    </div>
  );
}
