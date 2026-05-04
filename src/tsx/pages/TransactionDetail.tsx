import { router } from "@inertiajs/react";
import type { Transaction } from "../types";

interface Props {
  budget_pk: number;
  transaction: Transaction;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TransactionDetail({ budget_pk, transaction: txn }: Props) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="mb-0">{txn.description}</h1>
        <div className="flex gap-2">
          <a
            href={`/budgets/${budget_pk}/transactions/`}
            className="btn btn-outline-secondary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/transactions/`); }}
          >
            ← Back
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-5">
          <div className="card">
            <div className="card-header text-sm font-semibold text-muted py-2">Details</div>
            <div className="card-body">
              <dl className="mb-0">
                <dt>Description</dt>
                <dd>{txn.description}</dd>
                <dt>Due Date</dt>
                <dd>{fmtDate(txn.due_date)}</dd>
                <dt>Paid Date</dt>
                <dd>{fmtDate(txn.paid_date)}</dd>
                <dt>Status</dt>
                <dd>
                  {txn.transaction_type === "income"
                    ? <span className={`badge ${txn.is_paid ? "bg-success" : "bg-secondary"}`}>{txn.is_paid ? "Received" : "Pending"}</span>
                    : <span className={`badge ${txn.is_paid ? "bg-success" : "bg-warning text-dark"}`}>{txn.is_paid ? "Paid" : "Unpaid"}</span>}
                </dd>
                <dt>Payment Method</dt>
                <dd>{txn.payment_method_name ?? "—"}</dd>
                {txn.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd className="text-muted">{txn.notes}</dd>
                  </>
                )}
                {txn.recurring !== null && (
                  <>
                    <dt>Recurring</dt>
                    <dd>
                      <a
                        href={`/budgets/${budget_pk}/recurring/${txn.recurring}/`}
                        onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/${txn.recurring}/`); }}
                      >
                        View Schedule
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>

        <div className="md:col-span-7">
          <div className="card">
            <div className="card-header text-sm font-semibold text-muted py-2">Line Items</div>
            <div className="table-responsive">
              <table className="table table-sm mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {txn.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <a
                          href={`/budgets/${budget_pk}/transactions/?category=${line.category}`}
                          className="no-underline text-body"
                          onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/transactions/?category=${line.category}`); }}
                        >
                          {line.category_name}
                        </a>
                      </td>
                      <td className={`text-right font-semibold ${line.category_type === "income" ? "text-success" : "text-danger"}`}>
                        ${parseFloat(line.amount).toFixed(2)}
                      </td>
                      <td className="text-muted text-sm">{line.description}</td>
                    </tr>
                  ))}
                  <tr className="table-light font-semibold">
                    <td>Total</td>
                    <td className={`text-right ${txn.transaction_type === "income" ? "text-success" : "text-danger"}`}>
                      ${parseFloat(txn.total_amount).toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
