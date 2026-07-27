import { router } from "@inertiajs/react";
import { useState } from "react";
import { toast } from "sonner";
import type { Transaction } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "../utils/date";
import { fmt, useCurrencySymbol } from "../utils/currency";
import { jsonFetch } from "../lib/api";

interface Props {
  budget_pk: number;
  transaction: Transaction;
}

export default function TransactionDetail({ budget_pk, transaction: txn }: Props) {
  const symbol = useCurrencySymbol();
  const [candidates, setCandidates] = useState<Transaction[] | null>(null);
  const [busy, setBusy] = useState(false);
  const partnerId = txn.transfer_partner_id ?? null;

  async function loadCandidates() {
    setBusy(true);
    try {
      const data = await jsonFetch<{ candidates: Transaction[] }>(
        `/budgets/${budget_pk}/transactions/${txn.id}/transfer-candidates/`,
        "GET",
      );
      setCandidates(data?.candidates ?? []);
    } catch (err) {
      toast.error((err as { error?: string })?.error ?? "Couldn't load transfer candidates.");
    } finally {
      setBusy(false);
    }
  }

  async function link(partner: Transaction) {
    setBusy(true);
    try {
      await jsonFetch(
        `/budgets/${budget_pk}/transactions/${txn.id}/transfer-link/`,
        "PATCH",
        { partner_id: partner.id },
      );
      toast.success(`Linked to "${partner.description}".`);
      router.reload({ only: ["transaction"] });
    } catch (err) {
      toast.error((err as { error?: string })?.error ?? "Couldn't link transfer.");
    } finally {
      setBusy(false);
      setCandidates(null);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await jsonFetch(
        `/budgets/${budget_pk}/transactions/${txn.id}/transfer-link/`,
        "PATCH",
        { partner_id: null },
      );
      toast.success("Transfer unlinked.");
      router.reload({ only: ["transaction"] });
    } catch {
      toast.error("Couldn't unlink.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">{txn.description}</h1>
        <Button asChild variant="outline" size="sm">
          <a
            href={`/budgets/${budget_pk}/transactions/`}
            onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/transactions/`); }}
          >
            ← Back
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <Card className="md:col-span-5 p-0 gap-0 overflow-hidden">
          <div className="px-6 py-2 text-sm font-semibold text-muted-foreground border-b">Details</div>
          <div className="p-6">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Description</dt>
              <dd>{txn.description}</dd>
              <dt className="text-muted-foreground">Due Date</dt>
              <dd>{fmtDate(txn.due_date)}</dd>
              <dt className="text-muted-foreground">Paid Date</dt>
              <dd>{fmtDate(txn.paid_date)}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {txn.transaction_type === "income"
                  ? <Badge variant={txn.is_paid ? "success" : "secondary"}>{txn.is_paid ? "Received" : "Pending"}</Badge>
                  : <Badge variant={txn.is_paid ? "success" : "warning"}>{txn.is_paid ? "Paid" : "Unpaid"}</Badge>}
              </dd>
              <dt className="text-muted-foreground">Payment Method</dt>
              <dd>{txn.payment_method_name ?? "—"}</dd>
              {txn.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="text-muted-foreground">{txn.notes}</dd>
                </>
              )}
              {txn.recurring !== null && (
                <>
                  <dt className="text-muted-foreground">Recurring</dt>
                  <dd>
                    <a
                      href={`/budgets/${budget_pk}/recurring/${txn.recurring}/`}
                      className="text-primary hover:underline"
                      onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/${txn.recurring}/`); }}
                    >
                      View Schedule
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </Card>

        <Card className="md:col-span-7 p-0 gap-0 overflow-hidden">
          <div className="px-4 py-2 text-sm font-semibold text-muted-foreground border-b">Line Items</div>
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
                  <TableCell>
                    <a
                      href={`/budgets/${budget_pk}/transactions/?category=${line.category}`}
                      className="no-underline hover:underline"
                      onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/transactions/?category=${line.category}`); }}
                    >
                      {line.category_name}
                    </a>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${line.category_type === "income" ? "text-primary" : "text-destructive"}`}>
                    {fmt(line.amount, symbol)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{line.description}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 hover:bg-muted/50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className={`text-right ${txn.transaction_type === "income" ? "text-primary" : "text-destructive"}`}>
                  {fmt(txn.total_amount, symbol)}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6 p-0 gap-0 overflow-hidden">
        <div className="px-6 py-2 text-sm font-semibold text-muted-foreground border-b flex items-center justify-between">
          <span>Transfer Link</span>
          {partnerId === null && candidates === null && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadCandidates()}>
              Find transfer partner
            </Button>
          )}
        </div>
        <div className="p-6 text-sm">
          {partnerId !== null ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Badge variant="secondary" className="mr-2">Linked</Badge>
                This transaction is paired with another as a transfer; both legs are excluded from headline income/expense totals.
                {" "}
                <a
                  href={`/budgets/${budget_pk}/transactions/${partnerId}/`}
                  className="text-primary hover:underline"
                  onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/transactions/${partnerId}/`); }}
                >
                  View partner →
                </a>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void unlink()}>
                Unlink
              </Button>
            </div>
          ) : candidates === null ? (
            <p className="text-muted-foreground">
              Not linked. Use <em>Find transfer partner</em> if this is one leg of a movement between accounts (e.g. checking → savings) — pairing prevents double-counting in reports.
            </p>
          ) : candidates.length === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-muted-foreground">No matching transactions found (same amount, opposite direction, within ±3 days, different payment method).</p>
              <Button size="sm" variant="ghost" onClick={() => setCandidates(null)}>Dismiss</Button>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground mb-3">Pick the matching counterpart:</p>
              <ul className="divide-y border rounded">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(c.paid_date ?? c.due_date)} · {c.payment_method_name ?? "—"} · <span className="tabular-nums">{fmt(c.total_amount, symbol)}</span>
                      </div>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void link(c)}>Link</Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button size="sm" variant="ghost" onClick={() => setCandidates(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
