import { useState } from "react";
import { router } from "@inertiajs/react";
import TransactionModal from "../components/TransactionModal";
import type { Category, PaymentMethod, Transaction } from "../types";

interface Props {
  budget_pk: number;
  month: string;
  category_filter: string;
  transactions: Transaction[];
  categories: Category[];
  payment_methods: PaymentMethod[];
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Transactions({ budget_pk, month, category_filter, transactions: initialTxns, categories, payment_methods }: Props) {
  const [transactions, setTransactions] = useState(initialTxns);
  const [editDesc, setEditDesc] = useState<Record<number, string>>({});
  const [editDate, setEditDate] = useState<Record<number, string>>({});
  const [editPM, setEditPM] = useState<number | null>(null);
  const [addType, setAddType] = useState<"income" | "expense" | null>(null);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [markingPaid, setMarkingPaid] = useState<Set<number>>(new Set());

  const isCurrentMonth = month === getDefaultMonth();

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

  const [deletingId, setDeletingId] = useState<number | null>(null);

  function renderRow(txn: Transaction) {
    const isSplit = txn.lines.length > 1;
    const isExpanded = expandedId === txn.id;
    const primaryCategory = txn.lines[0];
    const isEditingDesc = txn.id in editDesc;
    const isEditingDate = txn.id in editDate;
    const isEditingPM = editPM === txn.id;
    const isMarking = markingPaid.has(txn.id);
    const isDeleting = deletingId === txn.id;
    const pmName = txn.payment_method_name;

    return [
      <tr key={txn.id} className={txn.is_paid ? "text-muted" : ""}>
        {/* Description */}
        <td>
          {isEditingDesc ? (
            <input
              className="form-control form-control-sm"
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
            <span style={{ cursor: "text" }} onClick={() => setEditDesc((prev) => ({ ...prev, [txn.id]: txn.description }))}>
              {txn.description}
            </span>
          )}
          {txn.recurring !== null && <span className="badge bg-secondary ms-1" style={{ fontSize: "0.65rem" }}>recurring</span>}
          {isSplit && (
            <button
              className="btn btn-link btn-sm p-0 ms-2"
              style={{ fontSize: "0.75rem" }}
              onClick={() => setExpandedId(isExpanded ? null : txn.id)}
            >
              {isExpanded ? "▲" : `▼ ${txn.lines.length} items`}
            </button>
          )}
        </td>

        {/* Paid Date */}
        <td>
          {isEditingDate ? (
            <input
              className="form-control form-control-sm"
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
            <span style={{ cursor: "pointer" }} onClick={() => setEditDate((prev) => ({ ...prev, [txn.id]: txn.paid_date ?? "" }))}>
              {fmtDate(txn.paid_date)}
            </span>
          )}
        </td>

        {/* Category */}
        <td className="small text-muted">
          {isSplit ? (
            <span className="text-muted fst-italic">Split</span>
          ) : primaryCategory ? (
            primaryCategory.category_name
          ) : "—"}
        </td>

        {/* Amount */}
        <td className={`text-end fw-semibold ${txn.transaction_type === "income" ? "text-success" : "text-danger"}`}>
          ${parseFloat(txn.total_amount).toFixed(2)}
        </td>

        {/* Payment Method */}
        <td>
          {isEditingPM ? (
            <select
              className="form-select form-select-sm"
              value={txn.payment_method ?? ""}
              autoFocus
              onChange={(e) => { const v = e.target.value; void savePM(txn, v ? Number(v) : null); }}
              onBlur={() => setEditPM(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditPM(null); }}
            >
              <option value="">— None —</option>
              {payment_methods.map((pm) => (
                <option key={pm.id} value={pm.id}>{pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}</option>
              ))}
            </select>
          ) : (
            <span className="small text-muted" style={{ cursor: "pointer" }} onClick={() => setEditPM(txn.id)}>
              {pmName ?? <span className="fst-italic">—</span>}
            </span>
          )}
        </td>

        {/* Status + Actions */}
        <td className="text-end" style={{ whiteSpace: "nowrap" }}>
          {txn.transaction_type === "income" ? (
            <span className={`badge ${txn.is_paid ? "bg-success" : "bg-secondary"} me-2`}>{txn.is_paid ? "Received" : "Pending"}</span>
          ) : (
            <span className={`badge ${txn.is_paid ? "bg-success" : "bg-warning text-dark"} me-2`}>{txn.is_paid ? "Paid" : "Unpaid"}</span>
          )}
          {isDeleting ? (
            <>
              <button className="btn btn-danger btn-sm py-0 px-2 me-1" style={{ fontSize: "0.7rem" }} onClick={() => { void deleteTxn(txn); setDeletingId(null); }}>✓</button>
              <button className="btn btn-outline-secondary btn-sm py-0 px-2 me-1" style={{ fontSize: "0.7rem" }} onClick={() => setDeletingId(null)}>✕</button>
            </>
          ) : (
            <>
              <button
                className={`btn btn-sm py-0 px-2 me-1 ${txn.transaction_type === "income" ? "btn-outline-success" : "btn-outline-primary"}`}
                style={{ fontSize: "0.7rem" }}
                disabled={isMarking}
                onClick={() => void markPaid(txn)}
              >
                {isMarking ? "…" : txn.is_paid ? "↩" : (txn.transaction_type === "income" ? "Receive" : "✓ Pay")}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm py-0 px-2 me-1"
                style={{ fontSize: "0.7rem" }}
                onClick={() => setEditTxn(txn)}
              >
                Edit
              </button>
              <button
                className="btn btn-outline-danger btn-sm py-0 px-2"
                style={{ fontSize: "0.7rem" }}
                onClick={() => setDeletingId(txn.id)}
              >
                ✕
              </button>
            </>
          )}
        </td>
      </tr>,
      // Expanded split lines
      isExpanded && (
        <tr key={`${txn.id}-split`} className="table-light">
          <td colSpan={6} className="px-4 py-2">
            <table className="table table-sm mb-0">
              <thead>
                <tr><th>Category</th><th className="text-end">Amount</th><th>Note</th></tr>
              </thead>
              <tbody>
                {txn.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.category_name}</td>
                    <td className="text-end">${parseFloat(line.amount).toFixed(2)}</td>
                    <td className="text-muted">{line.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ),
    ];
  }

  return (
    <div>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-3">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate({ month: prevMonth(month), ...(category_filter ? { category: category_filter } : {}) })}>&laquo;</button>
          <h4 className="mb-0">{formatMonth(month)}</h4>
          <button className="btn btn-outline-secondary btn-sm" disabled={isCurrentMonth} onClick={() => navigate({ month: nextMonth(month), ...(category_filter ? { category: category_filter } : {}) })}>&raquo;</button>
        </div>
        <div className="d-flex gap-2">
          <div className="dropdown">
            <button className="btn btn-primary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown">+ Transaction</button>
            <ul className="dropdown-menu dropdown-menu-end">
              <li><button className="dropdown-item" onClick={() => setAddType("expense")}>Expense</button></li>
              <li><button className="dropdown-item" onClick={() => setAddType("income")}>Income</button></li>
            </ul>
          </div>
          <a href={`/budgets/${budget_pk}/`} className="btn btn-outline-secondary btn-sm" onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/`); }}>← Back</a>
        </div>
      </div>

      {/* Filters */}
      <div className="row g-2 mb-4 align-items-center">
        <div className="col-auto">
          <button
            className={`btn btn-sm ${!category_filter ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => navigate({ month })}
          >
            All
          </button>
        </div>
        <div className="col-auto">
          <select
            className="form-select form-select-sm"
            value={category_filter}
            onChange={(e) => {
              const v = e.target.value;
              navigate({ month, ...(v ? { category: v } : {}) });
            }}
          >
            <option value="">All categories</option>
            <optgroup label="Expense">
              {categories.filter((c) => c.category_type === "expense").map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Income">
              {categories.filter((c) => c.category_type === "income").map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Table */}
      {transactions.length === 0 ? (
        <div className="card">
          <div className="card-body text-muted">No transactions for this period.</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Paid Date</th>
                  <th>Category</th>
                  <th className="text-end">Amount</th>
                  <th>Payment Method</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => renderRow(txn))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Transaction Modal */}
      {(addType !== null || editTxn !== null) && (
        <>
          <div className="modal-backdrop fade show" onClick={() => { setAddType(null); setEditTxn(null); }} />
          <TransactionModal
            categories={categories}
            paymentMethods={payment_methods}
            budgetPk={budget_pk}
            transaction={editTxn}
            defaultCategoryType={editTxn ? undefined : addType ?? undefined}
            onSave={editTxn ? updateTransaction : createTransaction}
            onClose={() => { setAddType(null); setEditTxn(null); }}
          />
        </>
      )}
    </div>
  );
}
