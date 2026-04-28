import { useState } from "react";
import { router } from "@inertiajs/react";

interface RecurringTransaction {
  id: number;
  name: string;
  description: string;
  amount: string;
  category: number;
  category_name: string;
  category_type: "income" | "expense";
  payment_method: number | null;
  payment_method_name: string | null;
  frequency: string;
  interval: number;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  next_due_date: string | null;
}

interface Props {
  budget_pk: number;
  recurring_transactions: RecurringTransaction[];
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
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

function freqLabel(rt: RecurringTransaction): string {
  const labels: Record<string, string> = { monthly: "Monthly", every_n_months: "Every N Months", annually: "Annually" };
  const base = labels[rt.frequency] ?? rt.frequency;
  return rt.frequency === "every_n_months" ? `${base} (${rt.interval}mo)` : base;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAmount(amount: string): string {
  return "$" + parseFloat(amount).toFixed(2);
}

// Group by category, sorted income first then expense, then by category name
function groupByCategory(rts: RecurringTransaction[]) {
  const groups = new Map<string, { category_name: string; category_type: string; items: RecurringTransaction[] }>();
  const sorted = [...rts].sort((a, b) => {
    const typeOrder = { income: 0, expense: 1 };
    const tA = typeOrder[a.category_type as keyof typeof typeOrder] ?? 2;
    const tB = typeOrder[b.category_type as keyof typeof typeOrder] ?? 2;
    if (tA !== tB) return tA - tB;
    const catCmp = a.category_name.localeCompare(b.category_name);
    if (catCmp !== 0) return catCmp;
    return a.start_date.localeCompare(b.start_date);
  });
  for (const rt of sorted) {
    const key = String(rt.category);
    if (!groups.has(key)) groups.set(key, { category_name: rt.category_name, category_type: rt.category_type, items: [] });
    groups.get(key)!.items.push(rt);
  }
  return Array.from(groups.values());
}

export default function RecurringList({ budget_pk, recurring_transactions: initialRts }: Props) {
  const [rts, setRts] = useState(initialRts);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);

  async function handleDeactivate(rt: RecurringTransaction) {
    if (deactivatingId !== rt.id) { setDeactivatingId(rt.id); return; }
    try {
      await apiFetch(`/budgets/${budget_pk}/recurring/${rt.id}/`, "DELETE");
      setRts((prev) => prev.map((r) => r.id === rt.id ? { ...r, is_active: false, end_date: new Date().toISOString().split("T")[0] } : r));
    } finally {
      setDeactivatingId(null);
    }
  }

  async function handleReactivate(rt: RecurringTransaction) {
    try {
      await apiFetch(`/budgets/${budget_pk}/recurring/${rt.id}/`, "PATCH", { is_active: true, end_date: null });
      setRts((prev) => prev.map((r) => r.id === rt.id ? { ...r, is_active: true, end_date: null } : r));
    } catch {
      // silently fail
    }
  }

  const groups = groupByCategory(rts);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Recurring Transactions</h1>
        <div className="d-flex gap-2">
          <a href={`/budgets/${budget_pk}/recurring/create/`} className="btn btn-primary btn-sm" onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/create/`); }}>+ Add</a>
          <a href={`/budgets/${budget_pk}/`} className="btn btn-outline-secondary btn-sm" onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/`); }}>← Back to Budget</a>
        </div>
      </div>

      {rts.length === 0 ? (
        <div className="card">
          <div className="card-body text-muted">No recurring transactions yet.</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th style={{ width: "26%" }}>Name</th>
                  <th style={{ width: "20%" }}>Frequency</th>
                  <th style={{ width: "12%" }} className="text-end">Amount</th>
                  <th style={{ width: "14%" }}>Start Date</th>
                  <th style={{ width: "12%" }}>Status</th>
                  <th style={{ width: "16%" }}></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <>
                    <tr key={`header-${group.category_name}`} className="table-secondary">
                      <td colSpan={6} className="py-1 px-3">
                        <strong>{group.category_name}</strong>
                        <span className="text-muted small ms-1">({group.category_type === "income" ? "Income" : "Expense"})</span>
                      </td>
                    </tr>
                    {group.items.map((rt) => (
                      <tr key={rt.id} className={!rt.is_active ? "text-muted" : ""}>
                        <td>
                          <a
                            href={`/budgets/${budget_pk}/recurring/${rt.id}/`}
                            className="text-decoration-none text-body"
                            onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/${rt.id}/`); }}
                          >
                            {rt.name}
                          </a>
                        </td>
                        <td className="small">{freqLabel(rt)}</td>
                        <td className={`text-end small ${rt.category_type === "income" ? "text-success" : "text-danger"}`}>
                          {fmtAmount(rt.amount)}
                        </td>
                        <td className="small">{fmtDate(rt.start_date)}</td>
                        <td>
                          {rt.is_active
                            ? <span className="badge bg-success">Active</span>
                            : <span className="badge bg-secondary">Inactive</span>}
                        </td>
                        <td className="text-end" style={{ whiteSpace: "nowrap" }}>
                          {rt.is_active ? (
                            deactivatingId === rt.id ? (
                              <>
                                <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDeactivate(rt)}>Confirm</button>
                                <button className="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" style={{ fontSize: "0.75rem" }} onClick={() => setDeactivatingId(null)}>Cancel</button>
                              </>
                            ) : (
                              <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDeactivate(rt)}>Deactivate</button>
                            )
                          ) : (
                            <button className="btn btn-outline-success btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleReactivate(rt)}>↺ Reactivate</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
