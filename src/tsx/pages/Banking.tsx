import { router } from "@inertiajs/react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { jsonFetch } from "../lib/api";
import { fmtDate, fmtDateTime } from "../utils/date";

interface BankTransactionLite {
  id: number;
  simplefin_id: string;
  posted_at: string;
  posted_date: string;
  amount: string;
  description: string;
  payee: string;
  memo: string;
  status: "pending" | "linked" | "ignored";
  transaction_id: number | null;
  bank_account_id: number;
}

interface BankAccount {
  id: number;
  name: string;
  org_name: string;
  org_domain: string;
  currency: string;
  balance: string | null;
  available_balance: string | null;
  balance_as_of: string | null;
  payment_method_id: number | null;
  is_hidden: boolean;
  pending_count: number;
  transactions: BankTransactionLite[];
}

interface Connection {
  id: number;
  label: string;
  last_synced_at: string | null;
  last_sync_status: "ok" | "error" | "pending";
  last_sync_error: string;
  accounts: BankAccount[];
}

interface PaymentMethodOption {
  id: number;
  name: string;
  last_four: string;
  budget_id: number;
  budget_name: string;
}

interface Props {
  connections: Connection[];
  payment_methods: PaymentMethodOption[];
}

function fmtMoney(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function AccountCard({
  account,
  paymentMethods,
  onUpdate,
}: {
  account: BankAccount;
  paymentMethods: PaymentMethodOption[];
  onUpdate: (acct: BankAccount) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Group payment methods by budget for the dropdown.
  const grouped = paymentMethods.reduce<
    Record<string, { budget_id: number; budget_name: string; items: PaymentMethodOption[] }>
  >((acc, pm) => {
    const key = String(pm.budget_id);
    if (!acc[key]) acc[key] = { budget_id: pm.budget_id, budget_name: pm.budget_name, items: [] };
    acc[key].items.push(pm);
    return acc;
  }, {});

  async function setPaymentMethod(value: string) {
    setSaving(true);
    try {
      const updated = await jsonFetch<{ payment_method_id: number | null }>(`/banking/accounts/${account.id}/`, "PATCH", {
        payment_method_id: value === "none" ? null : Number(value),
      });
      if (updated) onUpdate({ ...account, payment_method_id: updated.payment_method_id });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-3 border-rule shadow-none">
      <CardContent>
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div>
            <div className="text-ink-quiet text-[0.6875rem] uppercase tracking-[0.08em] font-semibold">
              {account.org_name}
            </div>
            <div className="font-medium mt-1 flex items-center gap-2 flex-wrap">
              {account.name}
              {account.pending_count > 0 && <Badge variant="warning">{account.pending_count} pending</Badge>}
            </div>
            <div className="text-ink-quiet text-sm">Balance as of {fmtDateTime(account.balance_as_of)}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight tabular-nums">
              {fmtMoney(account.balance, account.currency)}
            </div>
            {account.available_balance && account.available_balance !== account.balance && (
              <div className="text-ink-quiet text-sm tabular-nums">
                Avail. {fmtMoney(account.available_balance, account.currency)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-quiet">Maps to</span>
          <Select
            value={account.payment_method_id ? String(account.payment_method_id) : "none"}
            onValueChange={(v) => void setPaymentMethod(v)}
            disabled={saving}
          >
            <SelectTrigger size="sm" className="min-w-[260px]">
              <SelectValue placeholder="Pick a payment method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Not in any budget —</SelectItem>
              {Object.values(grouped).map((g) => (
                <SelectGroup key={g.budget_id}>
                  <SelectLabel>{g.budget_name}</SelectLabel>
                  {g.items.map((pm) => (
                    <SelectItem key={pm.id} value={String(pm.id)}>
                      {pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {account.transactions.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-3 -ml-3" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"} {account.transactions.length} recent transaction
            {account.transactions.length === 1 ? "" : "s"}
          </Button>
        )}

        {open && (
          <div className="mt-3 -mx-6 border-t border-rule">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.transactions.map((t) => {
                  const negative = Number.parseFloat(t.amount) < 0;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="tabular-nums">{fmtDate(t.posted_date)}</TableCell>
                      <TableCell>{t.payee || "—"}</TableCell>
                      <TableCell className="text-ink-quiet text-sm">{t.description}</TableCell>
                      <TableCell>
                        {t.status === "pending" && <Badge variant="warning">Pending</Badge>}
                        {t.status === "linked" && <span className="text-xs text-ink-quiet">Linked</span>}
                        {t.status === "ignored" && <span className="text-xs text-ink-quiet">Ignored</span>}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${negative ? "text-expense" : "text-income"}`}>
                        {fmtMoney(t.amount, account.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Banking({ connections: initialConnections, payment_methods }: Props) {
  const [connections, setConnections] = useState(initialConnections);
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    try {
      await jsonFetch("/banking/sync/", "POST");
      // Give the worker a moment, then reload the page data.
      setTimeout(() => {
        router.reload({ onFinish: () => setSyncing(false) });
      }, 1500);
    } catch {
      setSyncing(false);
    }
  }

  function updateAccount(updated: BankAccount) {
    setConnections((prev) =>
      prev.map((c) => ({
        ...c,
        accounts: c.accounts.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      })),
    );
  }

  const totalAccounts = connections.reduce((sum, c) => sum + c.accounts.length, 0);
  const totalPending = connections.reduce((sum, c) => sum + c.accounts.reduce((s, a) => s + a.pending_count, 0), 0);

  return (
    <div className="max-w-[1200px]">
      <header className="flex justify-between items-end mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Banking</h1>
          <p className="text-ink-quiet text-sm mt-1">
            {totalAccounts > 0 ? (
              <>
                {totalAccounts} account{totalAccounts === 1 ? "" : "s"} across {connections.length} connection
                {connections.length === 1 ? "" : "s"}
                {totalPending > 0 ? ` · ${totalPending} pending transaction${totalPending === 1 ? "" : "s"}` : ""}.
              </>
            ) : (
              "No accounts yet."
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button size="sm" onClick={() => void syncNow()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </header>

      {connections.length === 0 && (
        <Card className="border-rule shadow-none">
          <CardContent className="text-center py-12">
            <p className="mb-4 text-ink-quiet">No SimpleFIN connections yet.</p>
            <Button asChild>
              <a href="/accounts/settings/">Add a connection</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {connections.map((conn) => (
        <section key={conn.id} className="mb-8">
          <div className="flex justify-between items-baseline mb-3">
            <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">{conn.label}</h2>
            <span className="text-xs text-ink-quiet">Last synced {fmtDateTime(conn.last_synced_at)}</span>
          </div>

          {conn.last_sync_status === "error" && conn.last_sync_error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{conn.last_sync_error}</AlertDescription>
            </Alert>
          )}

          {conn.accounts.map((acct) => (
            <AccountCard key={acct.id} account={acct} paymentMethods={payment_methods} onUpdate={updateAccount} />
          ))}

          {conn.accounts.length === 0 && <p className="text-ink-quiet text-sm">No accounts. Try syncing.</p>}
        </section>
      ))}
    </div>
  );
}
