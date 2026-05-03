import { useState, useRef } from "react";
import { router } from "@inertiajs/react";
import { fmt, useCurrencySymbol } from "../utils/currency";

interface Category {
  id: number;
  name: string;
  category_type: "income" | "expense";
  monthly_budget: string;
}

interface PaymentMethod {
  id: number;
  name: string;
  payment_type: string;
  payment_type_display: string;
  last_four: string;
  is_active: boolean;
}

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

interface TransactionInstance {
  id: number;
  description: string;
  due_date: string;
  paid_date: string | null;
  is_paid: boolean;
  total_amount: string;
}

interface FreqChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  recurring: RecurringTransaction;
  instances: TransactionInstance[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  freq_choices: FreqChoice[];
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}


interface InlineTextFieldProps {
  value: string;
  type?: "text" | "number" | "date";
  onSave: (val: string) => Promise<void>;
  format?: (val: string) => string;
  placeholder?: string;
}

function InlineTextField({ value, type = "text", onSave, format, placeholder }: InlineTextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function display() {
    return format ? format(value) : (value || "—");
  }

  async function commit() {
    setEditing(false);
    if (draft === value || (!draft && !value)) return;
    try {
      await onSave(draft);
    } catch {
      setDraft(value);
    }
  }

  if (!editing) {
    return (
      <span style={{ cursor: "text" }} onClick={() => { setDraft(value); setEditing(true); }}>
        {display()}
      </span>
    );
  }

  return (
    <input
      className="form-control form-control-sm"
      type={type}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? "0.01" : undefined}
      value={draft}
      placeholder={placeholder}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); void commit(); }
        if (e.key === "Escape") { setEditing(false); setDraft(value); }
      }}
    />
  );
}

export default function RecurringDetail({ budget_pk, recurring: initialRt, instances: initialInstances, categories, payment_methods, freq_choices }: Props) {
  const symbol = useCurrencySymbol();
  const [rt, setRt] = useState(initialRt);
  const [instances, setInstances] = useState(initialInstances);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [addDueDate, setAddDueDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [deletingRt, setDeletingRt] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function patchRt(data: Record<string, unknown>) {
    const updated = await apiFetch(`/budgets/${budget_pk}/recurring/${rt.id}/`, "PATCH", data) as RecurringTransaction;
    setRt(updated);
  }

  async function handleAddInstance(e: React.FormEvent) {
    e.preventDefault();
    if (!addDueDate) { setAddError("Due date is required."); return; }
    setAddSaving(true);
    setAddError("");
    try {
      const txn = await apiFetch(`/budgets/${budget_pk}/recurring/${rt.id}/`, "POST", { due_date: addDueDate }) as TransactionInstance;
      setInstances((prev) => [...prev, txn].sort((a, b) => a.due_date.localeCompare(b.due_date)));
      setShowAddInstance(false);
    } catch (err) {
      const e = err as Record<string, string[]>;
      setAddError(Object.values(e).flat().join(" "));
    } finally {
      setAddSaving(false);
    }
  }

  async function handleMarkPaid(txn: TransactionInstance) {
    try {
      const updated = await apiFetch(`/budgets/${budget_pk}/transactions/${txn.id}/mark-paid/`, "POST") as TransactionInstance;
      setInstances((prev) => prev.map((t) => t.id === txn.id ? updated : t));
    } catch {
      // silently fail
    }
  }

  async function handleDeleteInstance(txn: TransactionInstance) {
    try {
      await apiFetch(`/budgets/${budget_pk}/transactions/${txn.id}/delete/`, "DELETE");
      setInstances((prev) => prev.filter((t) => t.id !== txn.id));
    } catch {
      // silently fail
    }
  }

  async function handleDeleteRt() {
    if (!deletingRt) { setDeletingRt(true); return; }
    try {
      await apiFetch(`/budgets/${budget_pk}/recurring/${rt.id}/?permanent=true`, "DELETE");
      router.visit(`/budgets/${budget_pk}/recurring/`);
    } catch {
      setDeletingRt(false);
    }
  }

  const freqLabels: Record<string, string> = {};
  for (const f of freq_choices) freqLabels[f.value] = f.label;

  function freqDisplay(): string {
    const base = freqLabels[rt.frequency] ?? rt.frequency;
    return rt.frequency === "every_n_months" ? `${base} (every ${rt.interval} months)` : base;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start mb-4">
        <div>
          <h1 className="h3 mb-0">{rt.name}</h1>
          <p className="text-muted small mb-0">{freqDisplay()} — {fmt(rt.amount, symbol)}</p>
        </div>
        <div className="d-flex gap-2">
          <a
            href={`/budgets/${budget_pk}/recurring/${rt.id}/edit/`}
            className="btn btn-outline-secondary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/${rt.id}/edit/`); }}
          >
            Edit
          </a>
          {deletingRt ? (
            <>
              <button className="btn btn-danger btn-sm" onClick={() => void handleDeleteRt()}>Confirm Delete</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDeletingRt(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-outline-danger btn-sm" onClick={() => void handleDeleteRt()}>Delete</button>
          )}
          <a
            href={`/budgets/${budget_pk}/recurring/`}
            className="btn btn-outline-secondary btn-sm"
            onClick={(e) => { e.preventDefault(); router.visit(`/budgets/${budget_pk}/recurring/`); }}
          >
            ← Back
          </a>
        </div>
      </div>

      <div className="row g-4 mb-4">
        <div className="col-md-4">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center py-2">
              <span className="small fw-semibold text-muted">Details</span>
              <span className="small text-muted fst-italic">Click any value to edit</span>
            </div>
            <div className="card-body">
              <dl className="mb-0">
                <dt>Name</dt>
                <dd>
                  <InlineTextField
                    value={rt.name}
                    onSave={async (v) => { await patchRt({ name: v }); }}
                  />
                </dd>
                <dt>Category</dt>
                <dd>
                  <CategorySelect
                    value={rt.category}
                    categories={categories}
                    onSave={async (id) => { await patchRt({ category: id }); }}
                  />
                </dd>
                <dt>Amount</dt>
                <dd>
                  <InlineTextField
                    value={rt.amount}
                    type="number"
                    format={(v) => v ? fmt(v, symbol) : "—"}
                    onSave={async (v) => { await patchRt({ amount: v }); }}
                  />
                </dd>
                <dt>Frequency</dt>
                <dd>
                  <FrequencySelect
                    frequency={rt.frequency}
                    interval={rt.interval}
                    freqChoices={freq_choices}
                    onSave={async (freq, interval) => { await patchRt({ frequency: freq, ...(freq === "every_n_months" ? { interval } : {}) }); }}
                  />
                </dd>
                <dt>Start Date</dt>
                <dd>
                  <InlineTextField
                    value={rt.start_date}
                    type="date"
                    format={fmtDate}
                    onSave={async (v) => { await patchRt({ start_date: v }); }}
                  />
                </dd>
                <dt>End Date</dt>
                <dd>
                  <InlineTextField
                    value={rt.end_date ?? ""}
                    type="date"
                    format={(v) => v ? fmtDate(v) : "No end date"}
                    onSave={async (v) => { await patchRt({ end_date: v || null }); }}
                    placeholder="No end date"
                  />
                </dd>
                <dt>Payment Method</dt>
                <dd>
                  <PaymentMethodSelect
                    value={rt.payment_method}
                    paymentMethods={payment_methods}
                    onSave={async (id) => { await patchRt({ payment_method: id }); }}
                  />
                </dd>
                <dt>Description</dt>
                <dd>
                  <InlineTextField
                    value={rt.description}
                    onSave={async (v) => { await patchRt({ description: v }); }}
                  />
                </dd>
                <dt>Status</dt>
                <dd>
                  {rt.is_active
                    ? <span className="badge bg-success">Active</span>
                    : <span className="badge bg-secondary">Inactive</span>}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="col-md-8">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center py-2">
              <span>Generated Instances</span>
              <button className="btn btn-outline-primary btn-sm py-0" onClick={() => setShowAddInstance(true)}>+ Add Instance</button>
            </div>
            {instances.length === 0 ? (
              <div className="card-body text-muted small">No instances generated yet.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Due Date</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((t) => (
                      <tr key={t.id} className={t.is_paid ? "text-muted" : ""}>
                        <td className="small">{fmtDate(t.due_date)}</td>
                        <td>
                          {t.is_paid
                            ? <span className="badge bg-success">Paid</span>
                            : <span className="badge bg-warning text-dark">Unpaid</span>}
                        </td>
                        <td className="text-end" style={{ whiteSpace: "nowrap" }}>
                          <button
                            className="btn btn-outline-secondary btn-sm py-0 px-2"
                            style={{ fontSize: "0.75rem" }}
                            title={t.is_paid ? "Mark Unpaid" : "Mark Paid"}
                            onClick={() => void handleMarkPaid(t)}
                          >
                            {t.is_paid ? "↩" : "✓"}
                          </button>
                          <DeleteInstanceButton onDelete={() => void handleDeleteInstance(t)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddInstance && (
        <div className="modal show d-block" tabIndex={-1} style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={(e) => void handleAddInstance(e)}>
                <div className="modal-header">
                  <h5 className="modal-title">Add Instance</h5>
                  <button type="button" className="btn-close" onClick={() => setShowAddInstance(false)} />
                </div>
                <div className="modal-body">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={addDueDate}
                    autoFocus
                    onChange={(e) => setAddDueDate(e.target.value)}
                  />
                  {addError && <div className="text-danger small mt-2">{addError}</div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddInstance(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={addSaving}>Add</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      <dialog ref={dialogRef} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategorySelect({ value, categories, onSave }: { value: number; categories: Category[]; onSave: (id: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const display = categories.find((c) => c.id === value)?.name ?? "—";

  async function commit(id: number) {
    setEditing(false);
    if (id === value) return;
    try {
      await onSave(id);
    } catch {
      setDraft(value);
    }
  }

  if (!editing) {
    return <span style={{ cursor: "pointer" }} onClick={() => { setDraft(value); setEditing(true); }}>{display}</span>;
  }

  return (
    <select
      className="form-select form-select-sm"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(Number(e.target.value))}
      onBlur={() => void commit(draft)}
      onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
    >
      <optgroup label="Income">
        {categories.filter((c) => c.category_type === "income").map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </optgroup>
      <optgroup label="Expense">
        {categories.filter((c) => c.category_type === "expense").map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </optgroup>
    </select>
  );
}

function PaymentMethodSelect({ value, paymentMethods, onSave }: { value: number | null; paymentMethods: PaymentMethod[]; onSave: (id: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);

  const found = paymentMethods.find((pm) => pm.id === value);
  const display = found ? (found.last_four ? `${found.name} ···· ${found.last_four}` : found.name) : "—";

  async function commit(id: number | null) {
    setEditing(false);
    if (id === value) return;
    try {
      await onSave(id);
    } catch {
      setDraft(value);
    }
  }

  if (!editing) {
    return <span style={{ cursor: "pointer" }} onClick={() => { setDraft(value); setEditing(true); }}>{display}</span>;
  }

  return (
    <select
      className="form-select form-select-sm"
      value={draft ?? ""}
      autoFocus
      onChange={(e) => {
        const v = e.target.value ? Number(e.target.value) : null;
        setDraft(v);
        void commit(v);
      }}
      onBlur={() => void commit(draft)}
      onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
    >
      <option value="">— None —</option>
      {paymentMethods.map((pm) => (
        <option key={pm.id} value={pm.id}>{pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}</option>
      ))}
    </select>
  );
}

function FrequencySelect({ frequency, interval, freqChoices, onSave }: {
  frequency: string;
  interval: number;
  freqChoices: FreqChoice[];
  onSave: (freq: string, interval: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftFreq, setDraftFreq] = useState(frequency);
  const [draftInterval, setDraftInterval] = useState(interval);

  const freqLabels: Record<string, string> = {};
  for (const f of freqChoices) freqLabels[f.value] = f.label;
  const display = (freqLabels[frequency] ?? frequency) + (frequency === "every_n_months" ? ` (${interval}mo)` : "");

  async function commit() {
    setEditing(false);
    if (draftFreq === frequency && (draftFreq !== "every_n_months" || draftInterval === interval)) return;
    try {
      await onSave(draftFreq, draftInterval);
    } catch {
      setDraftFreq(frequency);
      setDraftInterval(interval);
    }
  }

  if (!editing) {
    return <span style={{ cursor: "pointer" }} onClick={() => setEditing(true)}>{display}</span>;
  }

  return (
    <div className="d-flex gap-1 align-items-center">
      <select
        className="form-select form-select-sm"
        style={{ maxWidth: "160px" }}
        value={draftFreq}
        autoFocus
        onChange={(e) => setDraftFreq(e.target.value)}
        onBlur={() => setTimeout(() => void commit(), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); } }}
      >
        {freqChoices.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      {draftFreq === "every_n_months" && (
        <input
          type="number"
          min={2}
          className="form-control form-control-sm"
          style={{ maxWidth: "60px" }}
          value={draftInterval}
          onChange={(e) => setDraftInterval(Number(e.target.value))}
        />
      )}
    </div>
  );
}

function DeleteInstanceButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <>
        <button className="btn btn-danger btn-sm py-0 px-2 ms-1" style={{ fontSize: "0.75rem" }} onClick={() => { setConfirming(false); onDelete(); }}>✕</button>
        <button className="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" style={{ fontSize: "0.75rem" }} onClick={() => setConfirming(false)}>↩</button>
      </>
    );
  }
  return (
    <button className="btn btn-outline-danger btn-sm py-0 px-2 ms-1" style={{ fontSize: "0.75rem" }} title="Delete" onClick={() => setConfirming(true)}>✕</button>
  );
}
