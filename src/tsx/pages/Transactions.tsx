import { router } from "@inertiajs/react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Download,
  Landmark,
  ListChecks,
  MoreHorizontal,
  PiggyBank,
  Plus,
  Search,
  SlidersHorizontal,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { MonthLabel } from "@/components/MonthLabel";
import { SwipeToDelete } from "@/components/SwipeToDelete";
import { TransactionImportModal } from "@/components/TransactionImportModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import TransactionModal from "../components/TransactionModal";
import { errorMessage, jsonFetch } from "../lib/api";
import { startPageTour, usePageTour } from "../lib/onboardingTour";
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

/**
 * The bar that appears once rows are selected.
 *
 * Every action laid out side by side wrapped to three rows and 130px at 390px — and with the 44px
 * touch floor applied that is closer to 190px, a fifth of the screen, hovering over the very rows
 * being selected. Below sm only the first action keeps a button and the rest collapse into one
 * menu, which is what the page header already does with export and import. Done stays visible at
 * every width: it is the way out of select mode, so it should never be behind a tap.
 */
function SelectionBar({
  count,
  noun,
  actions,
  onClear,
  onDone,
}: {
  count: number;
  noun: string;
  actions: { label: string; run: () => void; destructive?: boolean }[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [primary, ...secondary] = actions;
  return (
    /* The inset keeps the bar off the home indicator once the app is installed; it resolves to the
       plain 1rem in a browser tab. */
    <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-card p-3 shadow-lg">
      <span className="text-sm font-medium">
        {count} {noun}
      </span>
      <span className="flex-1" />
      <Button size="sm" variant={primary.destructive ? "destructive" : "outline"} onClick={primary.run}>
        {primary.label}
      </Button>
      <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        {secondary.map((a) => (
          <Button key={a.label} size="sm" variant={a.destructive ? "destructive" : "outline"} onClick={a.run}>
            {a.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="sm:hidden"
            aria-label="More bulk actions"
            title="More bulk actions"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        {/* side="top": the bar is pinned to the bottom of the screen, so a menu opening downward
            would land off it. */}
        <DropdownMenuContent align="end" side="top" className="w-52">
          {secondary.map((a) => (
            <DropdownMenuItem key={a.label} onClick={a.run} variant={a.destructive ? "destructive" : "default"}>
              {a.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClear}>Clear selection</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

interface Props {
  budget_pk: number;
  month: string;
  category_filter: string;
  method_filter: string;
  date_from: string;
  search: string;
  date_to: string;
  /** Drop the month window and list every matching transaction — how a goal's list is reached. */
  all_time?: boolean;
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

/**
 * One labelled row inside the mobile filter panel.
 *
 * `md:contents` dissolves the wrapper from md up, so the control it holds becomes a direct child of
 * the filter row again and the desktop layout is untouched — the same trick the tables use to fold
 * cells on a phone without disturbing the wide layout.
 */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 md:contents">
      <span className="w-16 shrink-0 text-xs text-ink-quiet md:hidden">{label}</span>
      {children}
    </div>
  );
}

export default function Transactions({
  budget_pk,
  month,
  category_filter,
  method_filter,
  date_from,
  search,
  date_to,
  all_time,
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
  // One row at a time, so a register does not end up with a trail of half-open rows behind you.
  const [swipeOpenId, setSwipeOpenId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [addType, setAddType] = useState<"income" | "expense" | null>(null);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Tapping a row normally opens the editor; in select mode it picks the row out instead, and the
  // checkbox column appears. Off by default so a phone shows a list of transactions rather than a
  // column of empty boxes — bulk editing is occasional, and asking for it is one tap from the menu.
  const [selectMode, setSelectMode] = useState(false);

  function leaveSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setSelectedBank(new Set());
  }

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

  function SortButton({ label, sortKey: key }: { label: string; sortKey: SortKey }) {
    const idx = sortOrder.findIndex((s) => s.key === key);
    const active = idx >= 0;
    const dir = active ? sortOrder[idx].dir : "asc";
    const rank = sortOrder.length > 1 && active ? idx + 1 : null;
    return (
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
    );
  }

  function SortHeader({ label, sortKey: key, className }: { label: string; sortKey: SortKey; className?: string }) {
    return (
      <TableHead className={`whitespace-nowrap ${className ?? ""}`}>
        <SortButton label={label} sortKey={key} />
      </TableHead>
    );
  }

  // The date sits under the description in the body cell, so its sort control sits under the
  // description in the header. Dropping the date column without this would take date sorting with
  // it — the one sort a register is actually for.
  function DescriptionSortHeader() {
    return (
      <TableHead className="whitespace-nowrap">
        <SortButton label="Description" sortKey="description" />
        <div className="mt-0.5 text-xs font-normal text-muted-foreground">
          <SortButton label="Date" sortKey="paid_date" />
        </div>
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
      ...(all_time ? { all: "1" } : {}),
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === "") delete current[key];
      else current[key] = value;
    }
    return current;
  }

  const hasFilters = Boolean(category_filter || method_filter || date_from || date_to || search || all_time);
  // Search is excluded: it has its own box that stays visible, so counting it would explain nothing
  // about what is hidden behind the toggle. A date range counts once, however it was set.
  const activeFilterCount = [category_filter, method_filter, date_from || date_to, all_time].filter(Boolean).length;
  const filteredCategoryName = category_filter
    ? (categories.find((c) => String(c.id) === category_filter)?.name ?? null)
    : null;
  const emptyMessage = search
    ? `No transactions match ${search}.`
    : all_time
      ? "Nothing logged for this yet."
      : "Nothing logged for this period.";
  // Local so typing doesn't round-trip on every keystroke; submitted on Enter or the button.
  const [searchDraft, setSearchDraft] = useState(search);
  // Phone only — from md up the filters are always laid out and this is ignored. Opens already
  // expanded when something is filtering, so an active narrowing is never hidden behind a tap.
  const [filtersOpen, setFiltersOpen] = useState(activeFilterCount > 0);
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
  async function deleteOne() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const res = (await jsonFetch(`/budgets/${budget_pk}/transactions/bulk/`, "POST", {
        action: "delete",
        ids: [deleteTarget.id],
      })) as { changed: number; skipped: { id: number; reason: string }[] } | null;
      const skipped = res?.skipped ?? [];
      // The endpoint declines some rows rather than failing — a bank-linked one would come straight
      // back on the next sync — and saying "deleted" over the top of that would be a lie.
      if (skipped.length > 0) toast.error(`Left alone: ${skipped[0].reason}.`);
      else toast.success("Transaction deleted.");
      setDeleteTarget(null);
      navigate(withFilters({}));
    } catch (err) {
      toast.error(errorMessage(err, "That transaction could not be deleted."));
    } finally {
      setDeleteBusy(false);
    }
  }

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

  // Delegates to the shared helper: reading only `err.error` meant every field-validation
  // message from the server was discarded in favour of the generic fallback.
  function errMsg(err: unknown, fallback: string): string {
    return errorMessage(err, fallback);
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

  /**
   * The ignore reason, editable in place.
   *
   * Shared because the reason appears twice: in its own column from sm up, and folded into the
   * primary cell below it. As a permanent column it squeezed the payee to 211px at 390px and left
   * the reason itself a 102px input, which is not enough room to type a sentence into.
   */
  function renderIgnoreReason(bt: BankTransaction) {
    function stopEditing() {
      setEditReason((prev) => {
        const next = { ...prev };
        delete next[bt.id];
        return next;
      });
    }
    if (bt.id in editReason) {
      return (
        <Input
          className="h-8 text-sm"
          autoFocus
          value={editReason[bt.id]}
          placeholder="Reason"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEditReason((prev) => ({ ...prev, [bt.id]: e.target.value }))}
          onBlur={() => {
            const val = editReason[bt.id];
            stopEditing();
            void saveIgnoreReason(bt, val ?? "");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") stopEditing();
          }}
        />
      );
    }
    return (
      <button
        type="button"
        className="block w-full text-left truncate text-sm italic rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 touch:min-h-11"
        title={bt.ignore_reason || "Click to add a reason"}
        onClick={(e) => {
          e.stopPropagation();
          setEditReason((prev) => ({ ...prev, [bt.id]: bt.ignore_reason ?? "" }));
        }}
      >
        {bt.ignore_reason || <span className="not-italic">—</span>}
      </button>
    );
  }

  function renderRow(txn: Transaction, opts: { suppressStateMarkers?: boolean; includeDueColumn?: boolean } = {}) {
    const isSplit = txn.lines.length > 1;
    const isExpanded = expandedId === txn.id;
    const primaryCategory = txn.lines[0];
    const isExpense = txn.transaction_type === "expense";
    const isIncome = txn.transaction_type === "income";
    // transaction_type "transfer" survives the retired transfer feature: the goal-deposit flow is
    // the only thing that still writes it, and the ready-to-assign maths keys off it.
    const isGoalDeposit = txn.transaction_type === "transfer";
    const amountClass = isIncome ? "text-income" : isGoalDeposit ? "text-fund" : "text-expense";
    const isSelected = selected.has(txn.id);
    const openRow = () => (selectMode ? toggleSelected(txn.id) : setEditTxn(txn));

    return (
      <Fragment key={txn.id}>
        {/* The whole row is the control. Every field used to be its own inline editor with a pencil
            and a mark-paid toggle beside them, which on a phone spent a quarter of the width on two
            44px buttons and put four separate tap targets in a space the size of a thumb. One target
            per row, opening the editor that can change anything, is both cleaner and less to learn.
            In select mode the same tap picks the row out instead, so bulk edits need no checkbox
            column sitting there permanently. */}
        <TableRow
          className={`group cursor-pointer ${txn.is_paid ? "text-muted-foreground" : ""}`}
          data-state={isSelected ? "selected" : undefined}
          onClick={openRow}
        >
          {selectMode && (
            <TableCell className="w-8 max-sm:w-11 max-sm:py-3">
              {/* stopPropagation sits on the box, not the cell. On the cell it meant the padding
                  around a 15px checkbox swallowed the tap and did nothing, so the box was the only
                  way in; on the box, the rest of the cell falls through to the row, which toggles
                  the same selection. Bank rows already relied on that fall-through. */}
              <Checkbox
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={() => toggleSelected(txn.id)}
                aria-label={`Select ${txn.description}`}
              />
            </TableCell>
          )}
          {/* No padding below sm: SwipeToDelete owns the cell so its Delete button can reach the
              row's edges, and the padding moves inside the sliding layer. Below sm this cell is the
              only visible one — the rest are display:none — so sliding it slides the row. */}
          <TableCell className="max-sm:p-0 max-sm:py-3 sm:py-2">
            <SwipeToDelete
              revealed={swipeOpenId === txn.id}
              onRevealedChange={(open) => setSwipeOpenId(open ? txn.id : null)}
              onDelete={() => {
                setSwipeOpenId(null);
                setDeleteTarget(txn);
              }}
            >
              <div className="max-sm:px-2 max-sm:py-3 sm:contents">
                {/* `sm:contents` dissolves this wrapper from sm up, so the wider cell keeps the exact
                layout it had; below sm it is the flex row that pairs the description with the amount
                whose own column is hidden. */}
                <div className="flex items-start justify-between gap-2 sm:contents">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="text-left rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRow();
                      }}
                      title={txn.description.length > DESCRIPTION_LIMIT ? txn.description : undefined}
                    >
                      {truncate(txn.description)}
                    </button>
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
                    {!opts.suppressStateMarkers && !txn.is_paid && !isGoalDeposit && (
                      <span className="text-xs italic text-fund">{isIncome ? "pending" : "unpaid"}</span>
                    )}
                    {isGoalDeposit && <Badge variant="warning">Goal</Badge>}
                    {isSplit && (
                      /* Stops at the row so expanding a split does not also open the editor. */
                      <button
                        type="button"
                        // 39x15 without the touch floor — a raw button, so it does not inherit the one
                        // every Button size carries.
                        className="text-xs text-muted-foreground hover:text-ink rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 touch:inline-flex touch:min-h-11 touch:min-w-11 touch:items-center touch:justify-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(isExpanded ? null : txn.id);
                        }}
                      >
                        {isExpanded ? "Hide" : `${txn.lines.length} items`}
                      </button>
                    )}
                  </div>
                  <span className={`sm:hidden shrink-0 font-medium tabular-nums ${amountClass}`}>
                    {isExpense ? "−" : isIncome ? "+" : ""}
                    {fmtConverted(txn.total_amount, txn.exchange_rate_to_usd, userRate, symbol)}
                    <span className="sr-only">
                      {isIncome ? " income" : isGoalDeposit ? " goal deposit" : " expense"}
                    </span>
                  </span>
                </div>
                {/* The date lives here at every width rather than in a column of its own. It is what makes
                the ordering legible, so it is the one field that never drops — and keeping it in the
                primary cell leaves category and method as the only two that come and go. An unpaid
                row has no paid_date to show, so it shows what it is actually waiting on instead. */}
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  {txn.paid_date ? (
                    <span className="tabular-nums">{fmtDate(txn.paid_date)}</span>
                  ) : (
                    <span className="text-fund">
                      Due <span className="tabular-nums">{fmtDate(txn.due_date)}</span>
                    </span>
                  )}
                  {txn.currency !== userCurrencyCode && (
                    /* Only below sm: from sm up the amount column carries the original currency itself. */
                    <span className="sm:hidden flex items-center gap-1.5">
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {fmt(txn.total_amount)} {txn.currency}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </SwipeToDelete>
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

          {/* Category comes back first as the table widens, method second — they are the only two
              columns that appear and disappear now, so the progression is one decision, not three. */}
          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
            {isSplit ? <span className="italic">Split</span> : primaryCategory ? primaryCategory.category_name : "—"}
          </TableCell>

          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
            {txn.payment_method_name ?? <span className="italic">—</span>}
          </TableCell>

          <TableCell className={`hidden sm:table-cell text-right font-medium tabular-nums ${amountClass}`}>
            {/* No role="img" here: it makes the element a leaf in the accessibility tree and
                lets aria-label replace its contents, so the amount itself never gets read.
                The visible +/− prefix carries the direction; the sr-only word names the type
                without hiding the number. */}
            <span>
              {isExpense ? "−" : isIncome ? "+" : ""}
              {fmtConverted(txn.total_amount, txn.exchange_rate_to_usd, userRate, symbol)}
              <span className="sr-only">{isIncome ? " income" : isGoalDeposit ? " goal deposit" : " expense"}</span>
            </span>
            {txn.currency !== userCurrencyCode && (
              <div className="text-muted-foreground font-normal text-[0.7rem]">
                {fmt(txn.total_amount)} {txn.currency}
              </div>
            )}
          </TableCell>
        </TableRow>
        {isExpanded && (
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {/* px-6 inside an already narrow cell left the nested table about 310px to lay three
                columns out in, so below sm the note folds under its category the same way the date
                folds under a description in the parent row. */}
            <TableCell
              colSpan={4 + (selectMode ? 1 : 0) + (opts.includeDueColumn ? 1 : 0)}
              className="max-sm:px-3 px-6 py-2"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txn.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.category_name}
                        {line.description && (
                          <div className="sm:hidden mt-0.5 text-xs text-muted-foreground">{line.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums align-top">
                        {fmtConverted(line.amount, txn.exchange_rate_to_usd, userRate, symbol)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{line.description}</TableCell>
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
  // Everything paid, goal deposits included. They used to be filtered out into a Transfers tab of
  // their own; with that tab gone, excluding them here would drop them out of the register.
  const rest = useMemo(() => transactions.filter((t) => Boolean(t.paid_date)), [transactions]);
  const sortedRest = useMemo(() => sortTransactions(rest, sortOrder), [rest, sortOrder]);

  // The tab actually on screen. `activeTab` stays null until something is clicked, and the default
  // is Logged whenever nothing is awaiting review — so a bare `activeTab === "logged"` check misses
  // the common case of landing on Logged without touching anything. The selection bars are rendered
  // outside <Tabs> and decide which bulk actions apply, so they need this rather than the raw state.
  const defaultTab = pending.length + bankTxns.length > 0 ? "pending" : "logged";
  const effectiveTab = activeTab ?? defaultTab;

  return (
    <div className="max-w-[1200px]">
      {/* Page header */}
      <header className="mb-6 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-2 sm:gap-3" data-tour="month-nav">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isAtBackLimit(month)}
            onClick={() =>
              navigate(withFilters({ month: prevMonth(month), date_from: null, date_to: null, all: null }))
            }
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          {/* text-xl below sm so the month, its arrows and both actions share one line. */}
          <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
            <MonthLabel month={month} />
          </h1>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isCurrentMonth}
            onClick={() =>
              navigate(withFilters({ month: nextMonth(month), date_from: null, date_to: null, all: null }))
            }
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        {/* Adding a transaction is the reason anyone opens this page, so it keeps a button of its
            own. Export, import and the tour were three more labelled buttons competing with it and
            with the month, which took the header to three lines on a phone; they are occasional, so
            they collapse into one overflow menu at every width. Filtering deliberately stays out of
            here — it belongs beside the search box, where the row of results is. */}
        <div className="flex items-center gap-2">
          <Button
            data-tour="txn-add"
            onClick={() => setAddType("expense")}
            aria-label="Add transaction"
            title="Add transaction"
          >
            <Plus />
            <span className="hidden sm:inline">Add Transaction</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More actions" title="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* Exports exactly what the filters and search have narrowed to, one row per line, in
                  the shape another budgeting app will accept. A plain link, so the browser handles
                  the download and the file is never held in memory here. */}
              <DropdownMenuItem asChild>
                <a
                  href={`/budgets/${budget_pk}/transactions/export/?${new URLSearchParams(withFilters({})).toString()}`}
                  download
                >
                  <Download aria-hidden className="size-4" />
                  Export {hasFilters ? "these rows" : "this list"}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImporting(true)}>
                <Upload aria-hidden className="size-4" />
                Import
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}>
                <ListChecks aria-hidden className="size-4" />
                {selectMode ? "Stop selecting" : "Select rows"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Deferred so the menu is closed before the tour paints its overlay, matching how the
                  sidebar starts the full run. */}
              <DropdownMenuItem onClick={() => setTimeout(() => startPageTour("transactions"), 50)}>
                <CircleHelp aria-hidden className="size-4" />
                Tour this page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Filter row.
          Laid out as one wrapping row from md up, and as two stacked blocks below it. Every control
          side by side came to five stacked rows on a phone — a screenful of filters before the first
          transaction — so only search stays out, and the rest hides behind a toggle that carries a
          count of what is currently narrowing the list. */}
      <div className="mb-6 flex flex-col gap-3 text-sm md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-2">
          <div className="relative grow md:grow-0">
            <Search aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-ink-quiet" />
            <Input
              type="search"
              aria-label="Search transactions by description"
              placeholder="Search all months"
              className="h-8 w-full pl-8 pr-8 md:w-[220px]"
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
          {/* Icon-only, so the search field keeps the width the word "Filters" was taking. The
              count it used to spell out becomes a badge on the corner — the one thing the label
              was carrying that the icon can't, since a narrowed list otherwise looks like an
              empty one. aria-label says it in full either way. */}
          <Button
            variant="outline"
            size="icon"
            className="relative shrink-0 md:hidden"
            aria-expanded={filtersOpen}
            aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : "Filters"}
            title={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : "Filters"}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            {activeFilterCount > 0 && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-moss text-[0.625rem] font-semibold text-moss-foreground tabular-nums"
              >
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
        {/* Below md this is a framed panel of labelled rows, so an open filter set reads as one
            surface rather than three loose controls dropped into the page — and so a set filter
            still says which dimension it is once the trigger reads "Groceries" instead of "All
            categories". From md up the frame, the labels and the rows all dissolve (md:contents)
            back into the single wrapping row the desktop layout has always used. */}
        <div
          className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 rounded-lg border border-rule bg-surface p-3 md:flex md:flex-row md:flex-wrap md:items-center md:rounded-none md:border-0 md:bg-transparent md:p-0`}
        >
          <div className="flex items-center justify-between md:hidden">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">Filters</span>
            {hasFilters && (
              <button
                type="button"
                className="cursor-pointer text-xs text-moss hover:underline"
                onClick={() => navigate({ month })}
              >
                Clear all
              </button>
            )}
          </div>
          <span className="hidden text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet mr-1 md:inline">
            Filter
          </span>
          <FilterField label="Category">
            <Select
              value={category_filter || "all"}
              onValueChange={(v) => navigate(withFilters({ category: v === "all" ? null : v }))}
            >
              <SelectTrigger size="sm" className="flex-1 min-w-0 md:flex-none md:w-auto md:min-w-[180px]">
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
          </FilterField>
          <FilterField label="Method">
            <Select
              value={method_filter || "all"}
              onValueChange={(v) => navigate(withFilters({ method: v === "all" ? null : v }))}
            >
              <SelectTrigger size="sm" className="flex-1 min-w-0 md:flex-none md:w-auto md:min-w-[160px]">
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
          </FilterField>
          <FilterField label="Days">
            <DateRangeFilter
              month={month}
              from={date_from}
              to={date_to}
              className="flex-1 min-w-0 md:flex-none"
              onChange={(f, t) => navigate(withFilters({ date_from: f || null, date_to: t || null }))}
            />
          </FilterField>
          {/* The panel header owns this below md, where a full-width ghost button under three
              controls read as a fourth filter. */}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => navigate({ month })}>
              Clear
            </Button>
          )}
        </div>
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
      {all_time && !search && (
        <p className="-mt-3 mb-6 text-sm text-ink-quiet">
          Showing every logged transaction
          {filteredCategoryName && (
            <>
              {" "}
              for <span className="text-ink">{filteredCategoryName}</span>
            </>
          )}
          , all time. Awaiting review stays on {formatMonth(month)}.
        </p>
      )}

      {transactions.length === 0 && bankTxns.length === 0 && ignoredBankTxns.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">{emptyMessage}</CardContent>
        </Card>
      ) : (
        (() => {
          const pendingCount = pending.length + bankTxns.length;
          const ignoredCount = ignoredBankTxns.length;
          return (
            <Tabs
              value={effectiveTab}
              onValueChange={(v) => {
                setActiveTab(v);
                // Per tab: a selection that survived the switch would let someone act on rows they
                // can no longer see — and, now that the bulk actions differ by tab, act on them
                // with the wrong tab's actions. The bank set was missed here originally.
                setSelected(new Set());
                setSelectedBank(new Set());
              }}
              className="gap-4"
            >
              <TabsList data-tour="txn-tabs">
                <TabsTrigger value="pending" disabled={pendingCount === 0}>
                  Pending {pendingCount > 0 && `(${pendingCount})`}
                </TabsTrigger>
                <TabsTrigger value="logged">Logged ({rest.length})</TabsTrigger>
                <TabsTrigger value="ignored" disabled={ignoredCount === 0}>
                  Ignored {ignoredCount > 0 && `(${ignoredCount})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending">
                <Card className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="hidden sm:table-header-group">
                        <TableRow>
                          {selectMode && (
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
                          )}
                          <TableHead>Description</TableHead>
                          <TableHead className="hidden sm:table-cell">Category</TableHead>
                          <TableHead className="hidden lg:table-cell">Method</TableHead>
                          <TableHead className="hidden sm:table-cell text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bankTxns.map((bt) => {
                          const amt = Number.parseFloat(bt.amount);
                          const negative = amt < 0;
                          const sourceLabel = bt.org_name || bt.bank_account_name;
                          return (
                            <TableRow
                              key={`bt-${bt.id}`}
                              className="group cursor-pointer"
                              data-state={selectedBank.has(bt.id) ? "selected" : undefined}
                              onClick={() => (selectMode ? toggleBank(bt.id) : setBankTxnToConfirm(bt))}
                            >
                              {selectMode && (
                                <TableCell className="w-8 max-sm:w-11 max-sm:py-3">
                                  {/* Without stopPropagation the box toggled twice — once here and
                                      once via the row's own handler — so ticking it left the row
                                      exactly as it was. */}
                                  <Checkbox
                                    checked={selectedBank.has(bt.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onCheckedChange={() => toggleBank(bt.id)}
                                    aria-label={`Select ${bt.payee || bt.description}`}
                                  />
                                </TableCell>
                              )}
                              <TableCell className="max-sm:py-3">
                                {/* Same shape as the transaction rows: the posted date always sits on
                                    the line beneath the payee, and below sm the amount joins it. */}
                                {/* items-center, not items-start: the amount belongs to the row, not
                                    to the payee line, and pinning it to the top left it hanging
                                    above the date line. */}
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <button
                                        type="button"
                                        className="text-left font-medium rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (selectMode) toggleBank(bt.id);
                                          else setBankTxnToConfirm(bt);
                                        }}
                                      >
                                        {bt.payee || bt.description || "—"}
                                      </button>
                                      <span
                                        className="inline-flex items-center gap-1 text-xs text-ink-quiet"
                                        title={`From ${sourceLabel}`}
                                      >
                                        <Landmark aria-hidden className="size-3" />
                                        bank
                                      </span>
                                    </div>
                                    <span className="text-xs text-ink-quiet">
                                      <span className="tabular-nums">{fmtDate(bt.posted_date)} · </span>
                                      {sourceLabel}
                                      {bt.payee && bt.description && bt.payee !== bt.description
                                        ? ` · ${bt.description}`
                                        : ""}
                                    </span>
                                  </div>
                                  <span
                                    className={`sm:hidden shrink-0 font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                                  >
                                    {fmtSigned(amt, symbol)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-sm text-muted-foreground italic">
                                Unassigned
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
                                <span className="text-muted-foreground italic">—</span>
                              </TableCell>
                              <TableCell
                                className={`hidden sm:table-cell text-right font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                              >
                                {fmtSigned(amt, symbol)}
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
                      <TableHeader className="hidden sm:table-header-group">
                        <TableRow>
                          {selectMode && (
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
                          )}
                          <TableHead>Description</TableHead>
                          {/* No Category column. Every row on this tab said "Ignored", which the
                              tab already says. */}
                          <TableHead className="hidden sm:table-cell">Reason</TableHead>
                          <TableHead className="hidden sm:table-cell text-right">Amount</TableHead>
                          <TableHead className="hidden sm:table-cell text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ignoredBankTxns.map((bt) => {
                          const amt = Number.parseFloat(bt.amount);
                          const negative = amt < 0;
                          const sourceLabel = bt.org_name || bt.bank_account_name;
                          return (
                            <TableRow
                              key={`ig-${bt.id}`}
                              className={`group text-muted-foreground ${selectMode ? "cursor-pointer" : ""}`}
                              data-state={selectedBank.has(bt.id) ? "selected" : undefined}
                              onClick={selectMode ? () => toggleBank(bt.id) : undefined}
                            >
                              {selectMode && (
                                <TableCell className="w-8 max-sm:w-11 max-sm:py-3">
                                  <Checkbox
                                    checked={selectedBank.has(bt.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onCheckedChange={() => toggleBank(bt.id)}
                                    aria-label={`Select ${bt.payee || bt.description}`}
                                  />
                                </TableCell>
                              )}
                              <TableCell className="max-sm:py-3">
                                {/* items-center, not items-start: the amount belongs to the row, not
                                    to the payee line, and pinning it to the top left it hanging
                                    above the date line. */}
                                <div className="flex items-center justify-between gap-2">
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
                                      <span className="tabular-nums">{fmtDate(bt.posted_date)} · </span>
                                      {sourceLabel}
                                      {bt.payee && bt.description && bt.payee !== bt.description
                                        ? ` · ${bt.description}`
                                        : ""}
                                    </span>
                                  </div>
                                  <span
                                    className={`sm:hidden shrink-0 font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                                  >
                                    {fmtSigned(amt, symbol)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell max-w-[220px]">
                                {renderIgnoreReason(bt)}
                              </TableCell>
                              <TableCell
                                className={`hidden sm:table-cell text-right font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}
                              >
                                {fmtSigned(amt, symbol)}
                              </TableCell>
                              <TableCell
                                className="hidden sm:table-cell text-right whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
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
                        <TableHeader className="hidden sm:table-header-group">
                          <TableRow>
                            {selectMode && (
                              <TableHead className="w-8">
                                <Checkbox
                                  checked={sortedRest.length > 0 && sortedRest.every((t) => selected.has(t.id))}
                                  onCheckedChange={(checked) =>
                                    setSelected(checked === true ? new Set(sortedRest.map((t) => t.id)) : new Set())
                                  }
                                  aria-label="Select every row in this tab"
                                />
                              </TableHead>
                            )}
                            <DescriptionSortHeader />
                            <SortHeader label="Category" sortKey="category" className="hidden sm:table-cell" />
                            <SortHeader label="Method" sortKey="payment_method" className="hidden lg:table-cell" />
                            <SortHeader label="Amount" sortKey="amount" className="hidden sm:table-cell text-right" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>{sortedRest.map((txn) => renderRow(txn))}</TableBody>
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
        <SelectionBar
          count={selectedBank.size}
          noun="bank rows selected"
          // The two tabs offer mirror-image actions, and each other's are meaningless: a row on the
          // Ignored tab is already ignored, and one awaiting review is already pending. Offering
          // both left the useful one second on the tab where it was the only thing you'd want.
          actions={
            effectiveTab === "ignored"
              ? [
                  { label: "Restore", run: () => setBankAction("restore") },
                  { label: "Delete", run: () => setBankAction("delete"), destructive: true },
                ]
              : [
                  { label: "Ignore", run: () => setBankAction("ignore") },
                  { label: "Delete", run: () => setBankAction("delete"), destructive: true },
                ]
          }
          onClear={() => setSelectedBank(new Set())}
          onDone={leaveSelectMode}
        />
      )}

      {bankAction && (
        <Dialog open onOpenChange={(open) => !open && setBankAction(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {bankAction === "delete" && `Delete ${selectedBank.size} bank rows?`}
                {bankAction === "ignore" && `Ignore ${selectedBank.size} bank rows?`}
                {bankAction === "restore" && `Restore ${selectedBank.size} bank rows?`}
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
              {bankAction === "restore" && <p className="text-xs text-ink-quiet">They go back to Awaiting review.</p>}
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

      {deleteTarget && (
        <Dialog open onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this transaction?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{deleteTarget.description}</span>
              {" · "}
              <span className="tabular-nums">
                {fmtConverted(deleteTarget.total_amount, deleteTarget.exchange_rate_to_usd, userRate, symbol)}
              </span>
            </p>
            <p className="text-xs text-alarm">This cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void deleteOne()} disabled={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          noun="selected"
          // Same mirror as the bank rows: a logged transaction has been paid, so "Mark paid" is
          // meaningless there, and one awaiting review has not been, so "Mark pending" is
          // meaningless on that tab. Only the one that can change anything is offered.
          actions={[
            { label: "Recategorise", run: () => setBulkAction("category") },
            { label: "Set method", run: () => setBulkAction("payment_method") },
            effectiveTab === "logged"
              ? { label: "Mark pending", run: () => setBulkAction("mark_unpaid") }
              : { label: "Mark paid", run: () => setBulkAction("mark_paid") },
            { label: "Delete", run: () => setBulkAction("delete"), destructive: true },
          ]}
          onClear={() => setSelected(new Set())}
          onDone={leaveSelectMode}
        />
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
              {bulkAction === "delete" && <p className="text-xs text-alarm">This cannot be undone.</p>}
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
          transaction={editTxn}
          defaultCategoryType={editTxn ? undefined : (addType ?? undefined)}
          onSave={editTxn ? updateTransaction : createTransaction}
          onClose={() => {
            setAddType(null);
            setEditTxn(null);
          }}
          onIgnoreLinkedBankTxn={ignoreLinkedBankTxn}
        />
      )}

      {bankTxnToConfirm && (
        <BankTransactionConfirmModal
          bankTxn={bankTxnToConfirm}
          budgetPk={budget_pk}
          categories={categories}
          onResolved={({ bankTxn, transaction }) => {
            setBankTxns((prev) => prev.filter((b) => b.id !== bankTxn.id));
            if (transaction) {
              setTransactions((prev) => {
                const existing = prev.find((x) => x.id === transaction.id);
                return existing ? prev.map((x) => (x.id === transaction.id ? transaction : x)) : [...prev, transaction];
              });
            }
            setBankTxnToConfirm(null);
          }}
          onClose={() => setBankTxnToConfirm(null)}
        />
      )}
    </div>
  );
}
