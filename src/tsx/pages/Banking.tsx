import { router } from "@inertiajs/react";
import { ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { errorMessage, jsonFetch } from "../lib/api";
import { fmtInCurrency } from "../utils/currency";
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
  holdings_count: number;
  transactions: BankTransactionLite[];
}

interface Connection {
  id: number;
  label: string;
  last_synced_at: string | null;
  last_success_at: string | null;
  last_sync_status: "ok" | "error" | "stale" | "pending";
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

type RoleKind = "budget" | "investment" | "unused";

const SECTIONS: { kind: RoleKind; title: string; blurb: string }[] = [
  {
    kind: "budget",
    title: "In your budget",
    blurb: "Mapped to a payment method, so their transactions reach the register.",
  },
  { kind: "investment", title: "Investments", blurb: "Holdings feed the Investments page. Nothing to map." },
  { kind: "unused", title: "Not used", blurb: "Not mapped to a budget and holding no positions." },
];

function accountRole(
  account: BankAccount,
  paymentMethods: PaymentMethodOption[],
): { kind: RoleKind; label: string; quiet: boolean } {
  // A payment method outranks holdings deliberately. An account can be both — a savings account
  // paying a couple of bills is still where money leaves from — and the mapping is the part you
  // chose, so it decides which group the account belongs to.
  const pm = paymentMethods.find((p) => p.id === account.payment_method_id);
  // The arrow is only for a mapping you chose. An investment account isn't mapped to anything —
  // its holdings are the link — so prefixing it with "→" would claim the opposite of the point.
  if (pm) {
    return { kind: "budget", label: `→ ${pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}`, quiet: false };
  }
  if (account.holdings_count > 0) {
    return {
      kind: "investment",
      label: `${account.holdings_count} position${account.holdings_count === 1 ? "" : "s"}`,
      quiet: false,
    };
  }
  return { kind: "unused", label: "Not used", quiet: true };
}

function AccountCard({
  account,
  paymentMethods,
  onUpdate,
  onHiddenChange,
}: {
  account: BankAccount;
  paymentMethods: PaymentMethodOption[];
  onUpdate: (acct: BankAccount) => void;
  onHiddenChange: (acct: BankAccount, hidden: boolean) => void;
}) {
  // Collapsed by default. Fourteen accounts each carrying a 260px-minimum payment-method dropdown
  // did not fit a 390px phone, and most of them are mapped once and never touched again — so the
  // dropdown moves behind a deliberate tap and the role line carries the answer at a glance.
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hiding, setHiding] = useState(false);
  const role = accountRole(account, paymentMethods);

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
      const updated = await jsonFetch<{ payment_method_id: number | null }>(
        `/banking/accounts/${account.id}/`,
        "PATCH",
        {
          payment_method_id: value === "none" ? null : Number(value),
        },
      );
      if (updated) onUpdate({ ...account, payment_method_id: updated.payment_method_id });
    } catch (err) {
      // Without this the rejection escaped as an unhandled promise and the dropdown simply
      // snapped back, giving no hint that the mapping had not been saved.
      toast.error(errorMessage(err, "Couldn't map that account."));
    } finally {
      setSaving(false);
    }
  }

  async function setHidden(hidden: boolean) {
    setHiding(true);
    try {
      await jsonFetch<{ is_hidden: boolean }>(`/banking/accounts/${account.id}/`, "PATCH", { is_hidden: hidden });
      onHiddenChange(account, hidden);
    } catch (err) {
      toast.error(errorMessage(err, hidden ? "Couldn't hide that account." : "Couldn't unhide that account."));
    } finally {
      setHiding(false);
    }
  }

  return (
    <Card className="mb-2 overflow-hidden p-0">
      {/* The whole header is the tap target, per the one-target-per-row rule. The name and balance
          share the top line and the role sits under it, so nothing has to wrap at 390px. */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full text-left px-4 py-3 hover:bg-muted/40 flex items-start gap-3"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 mt-0.5 text-ink-quiet" />
        ) : (
          <ChevronRight className="size-4 shrink-0 mt-0.5 text-ink-quiet" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium truncate">{account.name}</span>
            <span className="font-semibold tabular-nums shrink-0">
              {fmtInCurrency(account.balance, account.currency)}
            </span>
          </span>
          {/* The institution rides here now that the page groups by role rather than by
              connection. Truncates rather than wraps, so the row stays one line at 390px. */}
          <span className="mt-0.5 flex items-center gap-2">
            <span className={`text-xs truncate text-ink-quiet ${role.quiet ? "italic" : ""}`}>
              {account.org_name ? `${account.org_name} · ` : ""}
              {role.label}
            </span>
            {/* Only where it can be acted on. A pending row is one awaiting review, but
                BankTransaction.for_budget reaches a budget through bank_account__payment_method__
                budget — so on an account with no payment method those rows never reach the pending
                tab and nothing can ever clear them. Schwab alone was advertising 31 of them. */}
            {role.kind === "budget" && account.pending_count > 0 && (
              <Badge variant="warning" className="shrink-0">
                {account.pending_count} pending
              </Badge>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <CardContent className="px-4 pt-0 pb-4">
          <div className="text-ink-quiet text-sm">
            Balance as of {fmtDateTime(account.balance_as_of)}
            {account.available_balance && account.available_balance !== account.balance && (
              <>
                {" · avail. "}
                <span className="tabular-nums">{fmtInCurrency(account.available_balance, account.currency)}</span>
              </>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-ink-quiet">Maps to</span>
            <Select
              value={account.payment_method_id ? String(account.payment_method_id) : "none"}
              onValueChange={(v) => void setPaymentMethod(v)}
              disabled={saving}
            >
              {/* No min-width: 260px was wider than a 390px phone's content column once the
                  card's own padding came off it. */}
              <SelectTrigger size="sm" className="w-full sm:w-auto sm:min-w-[260px]">
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

          <div className="mt-3 flex items-center gap-1 flex-wrap">
            {account.transactions.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
                {open ? "Hide" : "Show"} {account.transactions.length} recent transaction
                {account.transactions.length === 1 ? "" : "s"}
              </Button>
            )}
            {/* Hiding is per-account and reversible from the Hidden section at the foot of the page.
                It only affects this page: an account with no payment method is already invisible to
                every budget, since BankTransaction.for_budget reaches a budget through one. */}
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-quiet"
              disabled={hiding}
              onClick={() => void setHidden(true)}
            >
              <EyeOff aria-hidden />
              Hide
            </Button>
          </div>

          {open && (
            <div className="mt-3 -mx-4 border-t border-rule">
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
                          {fmtInCurrency(t.amount, account.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
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
    } catch (err) {
      // The bare catch here reported nothing, so a queue failure looked exactly like a
      // successful sync that happened to find no new transactions.
      toast.error(errorMessage(err, "Couldn't start a sync."));
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

  function setAccountHidden(account: BankAccount, hidden: boolean) {
    updateAccount({ ...account, is_hidden: hidden });
    toast.success(hidden ? `${account.name} hidden.` : `${account.name} is back.`);
  }

  // Counts describe what's on screen. Including hidden accounts here would read as "14 accounts ·
  // 37 pending" above a page showing five of them and no pending at all.
  const hidden = connections.flatMap((c) => c.accounts.filter((a) => a.is_hidden));
  const visibleAccounts = connections.flatMap((c) => c.accounts.filter((a) => !a.is_hidden));
  const totalAccounts = visibleAccounts.length;
  // Same rule as the per-card badge: only rows that can actually be reviewed. Counting every
  // account's pending made the header advertise "37 pending transactions" when all 37 sat on
  // accounts mapped to no budget, where nothing can reach or clear them.
  const totalPending = visibleAccounts
    .filter((a) => accountRole(a, payment_methods).kind === "budget")
    .reduce((s, a) => s + a.pending_count, 0);

  // Grouped by what an account is *for* rather than by which connection served it. With one
  // connection the old grouping was a single heading over everything; the split people actually
  // want is the money they budget from versus the money they only watch.
  const byRole = SECTIONS.map((section) => ({
    ...section,
    accounts: visibleAccounts.filter((a) => accountRole(a, payment_methods).kind === section.kind),
  })).filter((s) => s.accounts.length > 0);

  return (
    <div className="max-w-[1200px]">
      <header className="flex justify-between items-end mb-8 flex-wrap gap-4">
        <div>
          <h1 className="sr-only">Banking</h1>
          <p className="text-ink-quiet text-sm">
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
          {/* Icon-only: this is the page's one action and the label was buying nothing at 390px.
              aria-label and title carry the name, and the icon spins while a sync is in flight so
              the disabled state reads as "working" rather than "broken". */}
          <Button
            size="icon"
            variant="outline"
            onClick={() => void syncNow()}
            disabled={syncing}
            aria-label={syncing ? "Syncing…" : "Sync now"}
            title={syncing ? "Syncing…" : "Sync now"}
          >
            <RefreshCw aria-hidden className={syncing ? "animate-spin" : undefined} />
          </Button>
        </div>
      </header>

      {connections.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <p className="mb-4 text-ink-quiet">No SimpleFIN connections yet.</p>
            <Button asChild>
              <a href="/accounts/settings/">Add a connection</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection health sits above the accounts rather than heading a section of them. It is
          about the pipe, not about any one account, and grouping by role means an unhealthy
          connection's accounts are now spread across several sections anyway. */}
      {connections.map((conn) => (
        <div key={conn.id} className="mb-4">
          {/* The last attempt is not the last success, and this used to show whichever came last
              regardless. A failed 04:00 run reported itself as "Last synced 04:00" beside its own
              error message. */}
          <p className="text-xs text-ink-quiet">
            {connections.length > 1 ? `${conn.label} · ` : ""}
            Last synced {fmtDateTime(conn.last_success_at ?? conn.last_synced_at)}
          </p>

          {/* A stalled bridge and a revoked access URL used to look identical. The first needs
              nothing from you and clears itself on the next run; the second needs re-linking and
              will not. A failure is quiet while a recent success stands behind it, and turns red
              once it has been failing long enough to mean something. */}
          {conn.last_sync_status === "stale" && conn.last_sync_error && (
            <p className="mt-2 mb-2 text-xs text-ink-quiet">
              The {fmtDateTime(conn.last_synced_at)} sync did not go through, so these figures are from{" "}
              {fmtDateTime(conn.last_success_at)}. It will try again on its own.
            </p>
          )}

          {conn.last_sync_status === "error" && conn.last_sync_error && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>
                {conn.label}: {conn.last_sync_error}
              </AlertDescription>
            </Alert>
          )}

          {conn.accounts.length === 0 && (
            <p className="text-ink-quiet text-sm">{conn.label} has no accounts yet. Try syncing.</p>
          )}
        </div>
      ))}

      {byRole.map((section) => (
        <section key={section.kind} className="mb-8">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">{section.title}</h2>
          <p className="text-xs text-ink-quiet mb-3">{section.blurb}</p>

          {section.accounts.map((acct) => (
            <AccountCard
              key={acct.id}
              account={acct}
              paymentMethods={payment_methods}
              onUpdate={updateAccount}
              onHiddenChange={setAccountHidden}
            />
          ))}
        </section>
      ))}

      {hidden.length > 0 && <HiddenAccounts accounts={hidden} onUnhide={setAccountHidden} />}
    </div>
  );
}

/**
 * Hidden accounts, folded away but never gone.
 *
 * Kept on the page rather than behind a settings screen so unhiding is where hiding was, and so the
 * count is a standing reminder that the list is not the whole picture.
 */
function HiddenAccounts({
  accounts,
  onUnhide,
}: {
  accounts: BankAccount[];
  onUnhide: (acct: BankAccount, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  async function unhide(account: BankAccount) {
    setBusy(account.id);
    try {
      await jsonFetch(`/banking/accounts/${account.id}/`, "PATCH", { is_hidden: false });
      onUnhide(account, false);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't unhide that account."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-8">
      <Button variant="ghost" size="sm" className="-ml-3 text-ink-quiet" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        Hidden ({accounts.length})
      </Button>

      {open &&
        accounts.map((acct) => (
          <Card key={acct.id} className="mt-2 p-0">
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{acct.name}</div>
                <div className="text-xs text-ink-quiet truncate">{acct.org_name}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={busy === acct.id}
                onClick={() => void unhide(acct)}
              >
                <Eye aria-hidden />
                Unhide
              </Button>
            </div>
          </Card>
        ))}
    </section>
  );
}
