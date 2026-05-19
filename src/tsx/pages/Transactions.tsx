import { Fragment, useMemo, useState } from "react";
import { router } from "@inertiajs/react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Landmark, Pencil, Undo2 } from "lucide-react";
import TransactionModal from "../components/TransactionModal";
import BankTransactionConfirmModal from "../components/BankTransactionConfirmModal";
import type { BankTransaction, Category, CurrencyOption, PaymentMethod, Transaction } from "../types";
import { fmt, fmtConverted, useCurrencyCode, useCurrencyRate, useCurrencySymbol } from "../utils/currency";
import { formatMonth, getDefaultMonth, isAtBackLimit, nextMonth, prevMonth } from "../utils/month";
import { getCsrfToken } from "../lib/api";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  budget_pk: number;
  month: string;
  category_filter: string;
  transactions: Transaction[];
  bank_transactions?: BankTransaction[];
  ignored_bank_transactions?: BankTransaction[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  currencies: CurrencyOption[];
  user_currency: string;
}

async function apiFetch(url: string, method: string, body?: object) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json() as { errors?: Record<string, string[]> };
    throw data.errors ?? data;
  }
  if (res.status === 204) return null;
  return res.json();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function Transactions({ budget_pk, month, category_filter, transactions: initialTxns, bank_transactions: initialBankTxns, ignored_bank_transactions: initialIgnoredBankTxns, categories, payment_methods, currencies, user_currency }: Props) {
  const symbol = useCurrencySymbol();
  const userRate = useCurrencyRate();
  const userCurrencyCode = useCurrencyCode();
  const [transactions, setTransactions] = useState(initialTxns);
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>(initialBankTxns ?? []);
  const [ignoredBankTxns, setIgnoredBankTxns] = useState<BankTransaction[]>(initialIgnoredBankTxns ?? []);
  const [bankTxnToConfirm, setBankTxnToConfirm] = useState<BankTransaction | null>(null);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(true);
  const [editReason, setEditReason] = useState<Record<number, string>>({});
  const [sortOrder, setSortOrder] = useState<SortEntry[]>([{ key: "paid_date", dir: "asc" }]);
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
          <span className={active ? "text-moss" : "text-muted-foreground/40"}>
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

  async function patchTxn(id: number, data: Record<string, unknown>) {
    const updated = await apiFetch(`/budgets/${budget_pk}/transactions/${id}/edit/`, "PATCH", data) as Transaction;
    setTransactions((prev) => prev.map((t) => t.id === id ? updated : t));
    return updated;
  }

  async function saveDesc(txn: Transaction) {
    const val = editDesc[txn.id];
    setEditDesc((prev) => { const n = { ...prev }; delete n[txn.id]; return n; });
    if (val === undefined || val === txn.description) return;
    await patchTxn(txn.id, { description: val });
  }

  async function saveDate(txn: Transaction) {
    const val = editDate[txn.id];
    setEditDate((prev) => { const n = { ...prev }; delete n[txn.id]; return n; });
    if (val === undefined || val === (txn.paid_date ?? "")) return;
    await patchTxn(txn.id, { paid_date: val || null });
  }

  async function savePM(txn: Transaction, pmId: number | null) {
    setEditPM(null);
    await patchTxn(txn.id, { payment_method: pmId });
  }

  async function markPaid(txn: Transaction) {
    setMarkingPaid((prev) => new Set(prev).add(txn.id));
    try {
      const updated = await apiFetch(`/budgets/${budget_pk}/transactions/${txn.id}/mark-paid/`, "POST") as Transaction;
      setTransactions((prev) => prev.map((t) => t.id === txn.id ? updated : t));
    } finally {
      setMarkingPaid((prev) => { const n = new Set(prev); n.delete(txn.id); return n; });
    }
  }

  async function createTransaction(data: Partial<Transaction>) {
    const res = await fetch(`/budgets/${budget_pk}/transactions/create/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json() as { errors?: Record<string, string[]> };
      throw json.errors ?? json;
    }
    const txn = await res.json() as Transaction;
    setTransactions((prev) => [...prev, txn]);
  }

  async function updateTransaction(data: Partial<Transaction>) {
    if (!editTxn) return;
    const res = await fetch(`/budgets/${budget_pk}/transactions/${editTxn.id}/edit/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json() as { errors?: Record<string, string[]> };
      throw json.errors ?? json;
    }
    const updated = await res.json() as Transaction;
    setTransactions((prev) => prev.map((t) => t.id === editTxn.id ? updated : t));
  }

  async function deleteTxn(txn: Transaction) {
    await apiFetch(`/budgets/${budget_pk}/transactions/${txn.id}/delete/`, "DELETE");
    setTransactions((prev) => prev.filter((t) => t.id !== txn.id));
  }

  async function restoreBankTxn(bt: BankTransaction) {
    const data = await apiFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/unlink/`, "POST") as { bank_transaction: BankTransaction };
    setIgnoredBankTxns((prev) => prev.filter((b) => b.id !== bt.id));
    setBankTxns((prev) => [data.bank_transaction, ...prev]);
  }

  async function saveIgnoreReason(bt: BankTransaction, reason: string) {
    if ((bt.ignore_reason ?? "") === reason.trim()) return;
    const data = await apiFetch(`/budgets/${budget_pk}/bank-transactions/${bt.id}/ignore/`, "POST", { reason: reason.trim() }) as { bank_transaction: BankTransaction };
    setIgnoredBankTxns((prev) => prev.map((b) => (b.id === bt.id ? data.bank_transaction : b)));
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
                    if (e.key === "Escape") setEditDesc((prev) => { const n = { ...prev }; delete n[txn.id]; return n; });
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="text-left rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 hover:underline"
                  onClick={() => setEditDesc((prev) => ({ ...prev, [txn.id]: txn.description }))}
                >
                  {txn.description}
                </button>
              )}
              {!opts.suppressStateMarkers && txn.recurring !== null && (
                <span className="text-xs italic text-ink-quiet" aria-label="Recurring">recurring</span>
              )}
              {txn.bank_linked && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-ink-quiet"
                  title="Linked to a bank transaction"
                  aria-label="Linked to bank"
                >
                  <Landmark className="size-3" />
                  bank
                </span>
              )}
              {!opts.suppressStateMarkers && !txn.is_paid && !isTransfer && (
                <span className="text-xs italic text-fund">
                  {isIncome ? "pending" : "unpaid"}
                </span>
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
            {txn.bank_linked ? (
              <span className="tabular-nums" title="Locked to the bank's posted date">
                {fmtDate(txn.paid_date)}
              </span>
            ) : isEditingDate ? (
              <Input
                className="h-8"
                type="date"
                value={editDate[txn.id]}
                autoFocus
                onChange={(e) => setEditDate((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                onBlur={() => void saveDate(txn)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveDate(txn);
                  if (e.key === "Escape") setEditDate((prev) => { const n = { ...prev }; delete n[txn.id]; return n; });
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

          <TableCell className="text-sm text-muted-foreground">
            {isSplit ? (
              <span className="italic">Split</span>
            ) : primaryCategory ? (
              primaryCategory.category_name
            ) : "—"}
          </TableCell>

          <TableCell className={`text-right font-medium tabular-nums ${amountClass}`}>
            <span aria-label={isIncome ? "Income" : isTransfer ? "Transfer" : "Expense"}>
              {isExpense ? "−" : isIncome ? "+" : ""}{fmtConverted(txn.total_amount, txn.exchange_rate_to_usd, userRate, symbol)}
            </span>
            {txn.currency !== userCurrencyCode && (
              <div className="text-muted-foreground font-normal text-[0.7rem]">
                {fmt(txn.total_amount)} {txn.currency}
              </div>
            )}
          </TableCell>

          <TableCell>
            {isEditingPM ? (
              <Select
                defaultValue={txn.payment_method ? String(txn.payment_method) : "none"}
                onValueChange={(v) => void savePM(txn, v === "none" ? null : Number(v))}
                onOpenChange={(open) => { if (!open) setEditPM(null); }}
                open
              >
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {payment_methods.map((pm) => (
                    <SelectItem key={pm.id} value={String(pm.id)}>{pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}</SelectItem>
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
            <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isMarking || txn.bank_linked}
                onClick={() => void markPaid(txn)}
                aria-label={
                  isMarking ? "Updating" :
                  txn.bank_linked ? "Locked to bank's posted date" :
                  txn.is_paid ? "Mark unpaid" :
                  isIncome ? "Mark received" :
                  isTransfer ? "Confirm transfer" :
                  "Mark paid"
                }
                title={
                  txn.bank_linked ? "Locked to the bank's posted date" :
                  txn.is_paid ? "Mark unpaid" :
                  isIncome ? "Mark received" :
                  "Mark paid"
                }
              >
                {txn.is_paid ? <Undo2 /> : <Check />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditTxn(txn)}
                aria-label="Edit transaction"
              >
                <Pencil />
              </Button>
              <ConfirmButton size="xs" onConfirm={() => deleteTxn(txn)} label="Delete" />
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
                      <TableCell className="text-right tabular-nums">{fmtConverted(line.amount, txn.exchange_rate_to_usd, userRate, symbol)}</TableCell>
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
    () =>
      transactions
        .filter((t) => !t.paid_date)
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [transactions],
  );
  const rest = useMemo(
    () => transactions.filter((t) => Boolean(t.paid_date)),
    [transactions],
  );
  const sortedRest = useMemo(() => sortTransactions(rest, sortOrder), [rest, sortOrder]);

  return (
    <div className="max-w-[1200px]">
      {/* Page header */}
      <header className="mb-6 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isAtBackLimit(month)}
            onClick={() => navigate({ month: prevMonth(month), ...(category_filter ? { category: category_filter } : {}) })}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">{formatMonth(month)}</h1>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isCurrentMonth}
            onClick={() => navigate({ month: nextMonth(month), ...(category_filter ? { category: category_filter } : {}) })}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        <Button onClick={() => setAddType("expense")}>+ Add Transaction</Button>
      </header>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet mr-1">Filter</span>
        <Select
          value={category_filter || "all"}
          onValueChange={(v) => navigate({ month, ...(v !== "all" ? { category: v } : {}) })}
        >
          <SelectTrigger size="sm" className="min-w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectGroup>
              <SelectLabel>Expense</SelectLabel>
              {categories.filter((c) => c.category_type === "expense" && !c.is_sinking_fund).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Income</SelectLabel>
              {categories.filter((c) => c.category_type === "income" && !c.is_sinking_fund).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectGroup>
            {categories.some((c) => c.is_sinking_fund) && (
              <SelectGroup>
                <SelectLabel>Goals (sinking funds)</SelectLabel>
                {categories.filter((c) => c.is_sinking_fund).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>◎ {c.name}</SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {category_filter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ month })}
          >
            Clear
          </Button>
        )}
      </div>

      {transactions.length === 0 && bankTxns.length === 0 && ignoredBankTxns.length === 0 ? (
        <Card className="border-rule shadow-none">
          <CardContent className="text-muted-foreground py-12 text-center">Nothing logged for this period.</CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {(pending.length > 0 || bankTxns.length > 0) && (
            <Card className="overflow-hidden p-0 border-rule shadow-none">
              <button
                type="button"
                className="w-full bg-fund-soft px-4 py-2 flex justify-between items-center text-left cursor-pointer hover:bg-fund-soft/80"
                onClick={() => setPendingOpen((o) => !o)}
                aria-expanded={pendingOpen}
              >
                <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                  {pendingOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Pending ({pending.length + bankTxns.length})
                </span>
                <span className="text-xs text-ink-quiet italic">
                  {bankTxns.length > 0 ? "Awaiting payment · confirm bank rows to record them" : "Awaiting payment"}
                </span>
              </button>
              {pendingOpen && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Method</TableHead>
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
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{bt.payee || bt.description || "—"}</span>
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-ink-quiet"
                                  title={`From ${sourceLabel}`}
                                  aria-label="Pending from bank"
                                >
                                  <Landmark className="size-3" />
                                  bank
                                </span>
                              </div>
                              <span className="text-xs text-ink-quiet">
                                {sourceLabel}
                                {bt.payee && bt.description && bt.payee !== bt.description ? ` · ${bt.description}` : ""}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">{fmtDate(bt.posted_date)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground italic">Unassigned</TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${negative ? "text-expense" : "text-income"}`}>
                            {negative ? "−" : "+"}${Math.abs(amt).toFixed(2)}
                          </TableCell>
                          <TableCell><span className="text-muted-foreground italic">—</span></TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setBankTxnToConfirm(bt)}
                                aria-label="Confirm bank transaction"
                                title="Confirm and add to budget"
                              >
                                <Check />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {pending.map((txn) => renderRow(txn, { suppressStateMarkers: true }))}
                  </TableBody>
                </Table>
              </div>
              )}
            </Card>
          )}

          {ignoredBankTxns.length > 0 && (
            <Card className="overflow-hidden p-0 border-rule shadow-none">
              <button
                type="button"
                className="w-full bg-muted/40 px-4 py-2 flex justify-between items-center text-left cursor-pointer hover:bg-muted/60"
                onClick={() => setIgnoredOpen((o) => !o)}
                aria-expanded={ignoredOpen}
              >
                <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet flex items-center gap-2">
                  {ignoredOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Ignored ({ignoredBankTxns.length})
                </span>
                <span className="text-xs text-ink-quiet italic">Click any row to restore</span>
              </button>
              {ignoredOpen && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead>Category</TableHead>
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
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium">{bt.payee || bt.description || "—"}</span>
                                  <span
                                    className="inline-flex items-center gap-1 text-xs"
                                    title={`From ${sourceLabel}`}
                                  >
                                    <Landmark className="size-3" />
                                    bank
                                  </span>
                                </div>
                                <span className="text-xs">
                                  {sourceLabel}
                                  {bt.payee && bt.description && bt.payee !== bt.description ? ` · ${bt.description}` : ""}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="tabular-nums">{fmtDate(bt.posted_date)}</TableCell>
                            <TableCell className="text-sm italic">Ignored</TableCell>
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
                                    setEditReason((prev) => { const n = { ...prev }; delete n[bt.id]; return n; });
                                    void saveIgnoreReason(bt, val ?? "");
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") {
                                      setEditReason((prev) => { const n = { ...prev }; delete n[bt.id]; return n; });
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="block w-full text-left truncate text-sm italic rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                                  title={bt.ignore_reason || "Click to add a reason"}
                                  onClick={() => setEditReason((prev) => ({ ...prev, [bt.id]: bt.ignore_reason ?? "" }))}
                                >
                                  {bt.ignore_reason || <span className="not-italic">—</span>}
                                </button>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-medium tabular-nums ${negative ? "text-expense/70" : "text-income/70"}`}>
                              {negative ? "−" : "+"}${Math.abs(amt).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
              )}
            </Card>
          )}

          {rest.length > 0 && (
            <Card className="overflow-hidden p-0 border-rule shadow-none">
              <button
                type="button"
                className="w-full bg-muted/30 px-4 py-2 flex justify-between items-center text-left cursor-pointer hover:bg-muted/50"
                onClick={() => setRestOpen((o) => !o)}
                aria-expanded={restOpen}
              >
                <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-2">
                  {restOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Logged ({rest.length})
                </span>
                <span className="text-xs text-ink-quiet italic">Recorded transactions</span>
              </button>
              {restOpen && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHeader label="Description" sortKey="description" />
                        <SortHeader label="Date" sortKey="paid_date" />
                        <SortHeader label="Category" sortKey="category" />
                        <SortHeader label="Amount" sortKey="amount" className="text-right" />
                        <SortHeader label="Method" sortKey="payment_method" />
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRest.map((txn) => renderRow(txn))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          )}
        </div>
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
          defaultCategoryType={editTxn ? undefined : addType ?? undefined}
          onSave={editTxn ? updateTransaction : createTransaction}
          onClose={() => { setAddType(null); setEditTxn(null); }}
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
                const existing = prev.find((t) => t.id === transaction.id);
                return existing
                  ? prev.map((t) => (t.id === transaction.id ? transaction : t))
                  : [...prev, transaction];
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
