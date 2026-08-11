import { router } from "@inertiajs/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Transaction } from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";
import { fmtDate } from "../utils/date";

interface Props {
  budget_pk: number;
  transaction: Transaction;
}

export default function TransactionDetail({ budget_pk, transaction: txn }: Props) {
  const symbol = useCurrencySymbol();
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">{txn.description}</h1>
        <Button asChild variant="outline" size="sm">
          <a
            href={`/budgets/${budget_pk}/transactions/`}
            onClick={(e) => {
              e.preventDefault();
              router.visit(`/budgets/${budget_pk}/transactions/`);
            }}
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
                {txn.transaction_type === "income" ? (
                  <Badge variant={txn.is_paid ? "success" : "secondary"}>{txn.is_paid ? "Received" : "Pending"}</Badge>
                ) : (
                  <Badge variant={txn.is_paid ? "success" : "warning"}>{txn.is_paid ? "Paid" : "Unpaid"}</Badge>
                )}
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
                      onClick={(e) => {
                        e.preventDefault();
                        router.visit(`/budgets/${budget_pk}/recurring/${txn.recurring}/`);
                      }}
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
                      onClick={(e) => {
                        e.preventDefault();
                        router.visit(`/budgets/${budget_pk}/transactions/?category=${line.category}`);
                      }}
                    >
                      {line.category_name}
                    </a>
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold ${line.category_type === "income" ? "text-primary" : "text-destructive"}`}
                  >
                    {fmt(line.amount, symbol)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{line.description}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 hover:bg-muted/50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell
                  className={`text-right ${txn.transaction_type === "income" ? "text-primary" : "text-destructive"}`}
                >
                  {fmt(txn.total_amount, symbol)}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
