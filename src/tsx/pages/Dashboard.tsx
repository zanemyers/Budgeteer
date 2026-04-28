import { router } from "@inertiajs/react";
import { useState } from "react";
import TransactionModal from "../components/TransactionModal";
import type { BudgetOverview, BudgetOverviewCategory, Category, PaymentMethod, Transaction } from "../types";

interface Props {
  budget_pk: number;
  month: string;
  overview: BudgetOverview;
  categories: Category[];
  payment_methods: PaymentMethod[];
  upcoming_transactions: Transaction[];
}

function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 1) return `${year - 1}-12`;
  return `${year}-${String(mon - 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 12) return `${year + 1}-01`;
  return `${year}-${String(mon + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function fmt(val: string): string {
  return `$${parseFloat(val).toFixed(2)}`;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function Dashboard({ budget_pk, month, overview, categories, payment_methods, upcoming_transactions }: Props) {
  const [editingAssigned, setEditingAssigned] = useState<Record<number, string>>({});
  const [editingBudgeted, setEditingBudgeted] = useState<Record<number, string>>({});
  const [savingAssigned, setSavingAssigned] = useState<Record<number, boolean>>({});
  const [savingBudgeted, setSavingBudgeted] = useState<Record<number, boolean>>({});
  const [markingPaid, setMarkingPaid] = useState<Set<number>>(new Set());
  const [addTransactionType, setAddTransactionType] = useState<"income" | "expense" | null>(null);

  const isCurrentMonth = month === getDefaultMonth();

  function navigateMonth(m: string) {
    router.get(`/budgets/${budget_pk}/`, { month: m }, { preserveState: false });
  }

  async function saveAssigned(cat: BudgetOverviewCategory) {
    const val = editingAssigned[cat.id];
    if (val === undefined || val === "") {
      setEditingAssigned((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
      return;
    }
    setSavingAssigned((prev) => ({ ...prev, [cat.id]: true }));
    try {
      const res = await fetch(`/budgets/${budget_pk}/category-budgets/${cat.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ assigned: val, month }),
      });
      if (res.ok || res.redirected) {
        // Partial reload: only refresh overview
        router.reload({ only: ["overview"], });
      }
    } finally {
      setEditingAssigned((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
      setSavingAssigned((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
    }
  }

  async function saveBudgeted(cat: BudgetOverviewCategory) {
    const val = editingBudgeted[cat.id];
    if (val === undefined || val === "") {
      setEditingBudgeted((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
      return;
    }
    setSavingBudgeted((prev) => ({ ...prev, [cat.id]: true }));
    try {
      const res = await fetch(`/budgets/${budget_pk}/categories/${cat.id}/edit/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ monthly_budget: val }),
      });
      if (res.ok) {
        router.reload({ only: ["overview"], });
      }
    } finally {
      setEditingBudgeted((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
      setSavingBudgeted((prev) => { const next = { ...prev }; delete next[cat.id]; return next; });
    }
  }

  async function markPaid(txnId: number) {
    setMarkingPaid((prev) => new Set(prev).add(txnId));
    try {
      await fetch(`/budgets/${budget_pk}/transactions/${txnId}/mark-paid/`, {
        method: "POST",
        headers: { "X-CSRFToken": getCsrfToken() },
      });
      router.reload({ only: ["overview", "upcoming_transactions"], });
    } finally {
      setMarkingPaid((prev) => { const next = new Set(prev); next.delete(txnId); return next; });
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
    router.reload({ only: ["overview", "upcoming_transactions"], });
  }

  function renderCategoryRow(cat: BudgetOverviewCategory) {
    const isEditingAssigned = cat.id in editingAssigned;
    const isEditingBudgeted = cat.id in editingBudgeted;
    const available = parseFloat(cat.available);
    const budgeted = parseFloat(cat.budgeted);
    const assigned = parseFloat(cat.assigned);
    const activity = parseFloat(cat.activity);
    const isExpense = cat.category_type === "expense";

    const budgetedClass = budgeted > 0 && activity > budgeted ? "text-danger" : "";
    const assignedClass = budgeted > 0 && assigned === budgeted ? "text-success" : "";
    const availableClass = isExpense
      ? available < 0 ? "text-danger fw-bold" : available === 0 ? "text-muted" : "text-success"
      : "text-success";

    return (
      <tr key={cat.id}>
        <td>
          <a href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`} className="text-decoration-none text-body">
            {cat.name}
          </a>
        </td>
        <td className="text-end">
          {isEditingBudgeted ? (
            <div className="input-group input-group-sm justify-content-end" style={{ maxWidth: 130 }}>
              <span className="input-group-text">$</span>
              <input
                type="number" className="form-control" min="0" step="0.01" autoFocus
                value={editingBudgeted[cat.id]}
                onChange={(e) => setEditingBudgeted((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void saveBudgeted(cat); if (e.key === "Escape") setEditingBudgeted((prev) => { const n = { ...prev }; delete n[cat.id]; return n; }); }}
                onBlur={() => void saveBudgeted(cat)}
                disabled={savingBudgeted[cat.id]}
              />
            </div>
          ) : (
            <span style={{ cursor: "pointer" }} title="Click to set monthly target" onClick={() => setEditingBudgeted((prev) => ({ ...prev, [cat.id]: "" }))}>
              {budgeted > 0 ? <span className={budgetedClass}>{fmt(cat.budgeted)}</span> : <span className="text-muted fst-italic">—</span>}
            </span>
          )}
        </td>
        <td className="text-end">
          {isEditingAssigned ? (
            <div className="input-group input-group-sm justify-content-end" style={{ maxWidth: 130 }}>
              <span className="input-group-text">$</span>
              <input
                type="number" className="form-control" min="0" step="0.01" autoFocus
                value={editingAssigned[cat.id]}
                onChange={(e) => setEditingAssigned((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void saveAssigned(cat); if (e.key === "Escape") setEditingAssigned((prev) => { const n = { ...prev }; delete n[cat.id]; return n; }); }}
                onBlur={() => void saveAssigned(cat)}
                disabled={savingAssigned[cat.id]}
              />
            </div>
          ) : (
            <span style={{ cursor: "pointer" }} title="Click to set assigned amount" onClick={() => setEditingAssigned((prev) => ({ ...prev, [cat.id]: "" }))}>
              {assigned > 0 ? <span className={assignedClass}>{fmt(cat.assigned)}</span> : <span className="text-muted fst-italic">—</span>}
            </span>
          )}
        </td>
        <td className="text-end">{fmt(cat.activity)}</td>
        <td className={`text-end ${availableClass}`}>{fmt(cat.available)}</td>
      </tr>
    );
  }

  const income = overview.categories.filter((c) => c.category_type === "income");
  const expense = overview.categories.filter((c) => c.category_type === "expense");
  const totalSpent = expense.reduce((sum, c) => sum + parseFloat(c.activity), 0);
  const netAmount = parseFloat(overview.income_total) - totalSpent;
  const netPositive = netAmount >= 0;
  const rta = parseFloat(overview.ready_to_assign);

  return (
    <div>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div className="d-flex align-items-center gap-3">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(prevMonth(month))}>&laquo;</button>
          <h4 className="mb-0">{formatMonth(month)}</h4>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(nextMonth(month))} disabled={isCurrentMonth}>&raquo;</button>
        </div>
        <div className="d-flex gap-2">
          <a className="btn btn-outline-secondary btn-sm" href={`/budgets/${budget_pk}/transactions/?month=${month}&category=`}>All Transactions</a>
          <div className="dropdown">
            <button className="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown">Manage</button>
            <ul className="dropdown-menu dropdown-menu-end">
              <li><a className="dropdown-item" href={`/budgets/${budget_pk}/categories/`}>Categories</a></li>
              <li><a className="dropdown-item" href={`/budgets/${budget_pk}/recurring/`}>Recurring</a></li>
              <li><a className="dropdown-item" href={`/budgets/${budget_pk}/members/`}>Members</a></li>
              <li><a className="dropdown-item" href="/accounts/payment-methods/">Payment Methods</a></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Ready to Assign */}
      {parseFloat(overview.income_total) > 0 && (
        <div className={`alert ${rta >= 0 ? "alert-success" : "alert-danger"} d-flex justify-content-between align-items-center mb-4`}>
          <div>
            <strong>Ready to Assign</strong>
            <div className="small text-muted">Income {fmt(overview.income_total)} &minus; Assigned {fmt(overview.expense_assigned)}</div>
          </div>
          <span className="fs-4 fw-bold">{fmt(overview.ready_to_assign)}</span>
        </div>
      )}

      {/* Upcoming Recurring */}
      {isCurrentMonth && upcoming_transactions.length > 0 && (
        <div className="card mb-4">
          <div className="card-header small fw-semibold text-muted py-2">Upcoming Recurring</div>
          <ul className="list-group list-group-flush">
            {upcoming_transactions.map((txn) => {
              const category = txn.lines[0]?.category_name ?? "";
              const isMarking = markingPaid.has(txn.id);
              const due = new Date(txn.due_date + "T00:00:00");
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const isOverdue = due < today;
              const dueFmt = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <li key={txn.id} className="list-group-item d-flex justify-content-between align-items-center py-2">
                  <div>
                    <div className="fw-medium">{txn.description}</div>
                    <div className="small text-muted">
                      {category && <span className="me-2">{category}</span>}
                      <span className={isOverdue ? "text-danger fw-semibold" : ""}>{dueFmt}</span>
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-3">
                    <span className={`fw-semibold ${txn.transaction_type === "income" ? "text-success" : "text-danger"}`}>
                      ${parseFloat(txn.total_amount).toFixed(2)}
                    </span>
                    <button className="btn btn-success btn-sm px-3" disabled={isMarking} onClick={() => void markPaid(txn.id)}>
                      {isMarking ? "…" : "✓"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Budget Grid */}
      {overview.categories.length === 0 ? (
        <div className="text-muted text-center py-5">
          No categories yet. <a href={`/budgets/${budget_pk}/categories/`}>Add some categories</a> to get started.
        </div>
      ) : (
        <div className="row g-3">
          {income.length > 0 && (
            <div className="col-md-4 d-flex flex-column gap-3">
              <div className="card">
                <div className="card-header bg-success bg-opacity-10 d-flex justify-content-between align-items-center">
                  <span className="text-success small fw-bold">Income</span>
                  <button className="btn btn-outline-success btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("income")}>+ Add</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light"><tr><th>Category</th><th className="text-end">Activity</th></tr></thead>
                    <tbody>
                      {income.map((cat) => (
                        <tr key={cat.id}>
                          <td><a href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`} className="text-decoration-none text-body">{cat.name}</a></td>
                          <td className="text-end text-success">{fmt(cat.activity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-body py-2">
                  <div className="d-flex justify-content-between align-items-center py-1">
                    <span className="small text-muted">Income</span>
                    <span className="fw-semibold text-success">{fmt(overview.income_total)}</span>
                  </div>
                  <div className="d-flex justify-content-between align-items-center py-1">
                    <span className="small text-muted">Spent</span>
                    <span className="fw-semibold text-danger">${totalSpent.toFixed(2)}</span>
                  </div>
                  <hr className="my-1" />
                  <div className="d-flex justify-content-between align-items-center py-1">
                    <span className="small fw-semibold">Net</span>
                    <span className={`fw-bold ${netPositive ? "text-success" : "text-danger"}`}>{`${netPositive ? "" : "-"}$${Math.abs(netAmount).toFixed(2)}`}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {expense.length > 0 && (
            <div className="col-md-8">
              <div className="card h-100">
                <div className="card-header bg-danger bg-opacity-10 d-flex justify-content-between align-items-center">
                  <span className="text-danger small fw-bold">Expenses</span>
                  <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("expense")}>+ Add</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light">
                      <tr><th>Category</th><th className="text-end">Budgeted</th><th className="text-end">Assigned</th><th className="text-end">Activity</th><th className="text-end">Available</th></tr>
                    </thead>
                    <tbody>{expense.map(renderCategoryRow)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transaction Modal */}
      {addTransactionType !== null && (
        <>
          <div className="modal-backdrop fade show" onClick={() => { setAddTransactionType(null); }} />
          <TransactionModal
            categories={categories}
            paymentMethods={payment_methods}
            budgetPk={budget_pk}
            transaction={null}
            defaultCategoryType={addTransactionType}
            onSave={createTransaction}
            onClose={() => { setAddTransactionType(null); }}
          />
        </>
      )}
    </div>
  );
}
