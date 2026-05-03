import { useState } from "react";

interface CategoryType {
  id: number;
  name: string;
  category_type: "income" | "expense";
  monthly_budget: string;
  is_sinking_fund: boolean;
  sinking_fund_target: string | null;
  sinking_fund_due_date: string | null;
  sinking_fund_ongoing: boolean;
  sinking_fund_monthly_goal: string | null;
  total_saved?: string;
}

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  categories: CategoryType[];
  type_choices: TypeChoice[];
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

export default function Categories({ budget_pk, categories: initialCategories }: Props) {
  const [categories, setCategories] = useState(initialCategories);
  const [showForm, setShowForm] = useState(false);
  const [showSinkingFundForm, setShowSinkingFundForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"income" | "expense">("expense");
  const [newSFName, setNewSFName] = useState("");
  const [newSFTarget, setNewSFTarget] = useState("");
  const [newSFDueDate, setNewSFDueDate] = useState("");
  const [newSFInitial, setNewSFInitial] = useState("");
  const [newSFOngoing, setNewSFOngoing] = useState(false);
  const [newSFMonthlyGoal, setNewSFMonthlyGoal] = useState("");
  const [formError, setFormError] = useState("");
  const [sfFormError, setSFFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editingSFId, setEditingSFId] = useState<number | null>(null);
  const [editSFName, setEditSFName] = useState("");
  const [editSFTarget, setEditSFTarget] = useState("");
  const [editSFDueDate, setEditSFDueDate] = useState("");
  const [editSFAddAmount, setEditSFAddAmount] = useState("");
  const [editSFAddDesc, setEditSFAddDesc] = useState("");
  const [editSFOngoing, setEditSFOngoing] = useState(false);
  const [editSFMonthlyGoal, setEditSFMonthlyGoal] = useState("");
  const [editSFSaving, setEditSFSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  const income = categories.filter((c) => c.category_type === "income" && !c.is_sinking_fund);
  const expense = categories.filter((c) => c.category_type === "expense" && !c.is_sinking_fund);
  const sinkingFunds = categories.filter((c) => c.is_sinking_fund);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const cat = await apiFetch(`/budgets/${budget_pk}/categories/create/`, "POST", {
        name: newName,
        category_type: newType,
      }) as CategoryType;
      setCategories((prev) => [...prev, cat]);
      setNewName("");
      setShowForm(false);
    } catch (err) {
      const e = err as Record<string, string[]>;
      setFormError(Object.values(e).flat().join(" "));
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(cat: CategoryType) {
    if (!editName.trim() || editName === cat.name) { setEditingId(null); return; }
    try {
      const updated = await apiFetch(`/budgets/${budget_pk}/categories/${cat.id}/edit/`, "PATCH", { name: editName }) as CategoryType;
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? updated : c)));
    } finally {
      setEditingId(null);
    }
  }

  async function handleCreateSinkingFund(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSFFormError("");
    try {
      const cat = await apiFetch(`/budgets/${budget_pk}/categories/create/`, "POST", {
        name: newSFName,
        category_type: "expense",
        is_sinking_fund: true,
        sinking_fund_target: newSFTarget,
        sinking_fund_due_date: newSFOngoing ? null : newSFDueDate,
        sinking_fund_ongoing: newSFOngoing,
        sinking_fund_monthly_goal: newSFOngoing ? newSFMonthlyGoal : null,
        sinking_fund_initial_balance: newSFInitial || "0",
      }) as CategoryType;
      setCategories((prev) => [...prev, cat]);
      setNewSFName(""); setNewSFTarget(""); setNewSFDueDate(""); setNewSFInitial(""); setNewSFOngoing(false); setNewSFMonthlyGoal("");
      setShowSinkingFundForm(false);
    } catch (err) {
      const e = err as Record<string, string[]>;
      setSFFormError(Object.values(e).flat().join(" "));
    } finally {
      setSaving(false);
    }
  }

  async function handleSFEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSFId) return;
    setEditSFSaving(true);
    try {
      const updated = await apiFetch(`/budgets/${budget_pk}/categories/${editingSFId}/edit/`, "PATCH", {
        name: editSFName,
        sinking_fund_target: editSFTarget,
        sinking_fund_due_date: editSFOngoing ? null : editSFDueDate,
        sinking_fund_ongoing: editSFOngoing,
        sinking_fund_monthly_goal: editSFOngoing ? editSFMonthlyGoal : null,
        add_amount: editSFAddAmount || "0",
        add_description: editSFAddDesc,
      }) as CategoryType;
      setCategories((prev) => prev.map((c) => (c.id === editingSFId ? updated : c)));
      setEditingSFId(null);
      setEditSFAddAmount("");
      setEditSFAddDesc("");
    } finally {
      setEditSFSaving(false);
    }
  }

  async function handleDelete(cat: CategoryType) {
    if (deletingId !== cat.id) { setDeletingId(cat.id); return; }
    try {
      await apiFetch(`/budgets/${budget_pk}/categories/${cat.id}/delete/`, "DELETE");
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch {
      setDeleteError((prev) => ({ ...prev, [cat.id]: "Cannot delete — category has transactions." }));
    } finally {
      setDeletingId(null);
    }
  }

  function renderSection(sectionCategories: CategoryType[], label: string, colorClass: string, wrapperClass = "col-md-6") {
    const card = (
      <div className="card">
        <div className={`card-header d-flex justify-content-between align-items-center bg-${colorClass} bg-opacity-10`}>
          <span className={`small fw-bold text-${colorClass}`}>{label}</span>
          <button
            className={`btn btn-outline-${colorClass} btn-sm py-0 px-2`}
            style={{ fontSize: "0.75rem" }}
            onClick={() => { setNewType(label.toLowerCase() as "income" | "expense"); setShowForm(true); }}
          >
            + Add
          </button>
        </div>
        {sectionCategories.length === 0 ? (
          <div className="card-body text-muted small">No {label.toLowerCase()} categories yet.</div>
        ) : (
          <ul className="list-group list-group-flush">
            {sectionCategories.map((cat) => (
              <li key={cat.id} className="list-group-item d-flex justify-content-between align-items-center py-2">
                {editingId === cat.id ? (
                  <input
                    className="form-control form-control-sm me-2"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => void handleRename(cat)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleRename(cat); if (e.key === "Escape") setEditingId(null); }}
                  />
                ) : (
                  <span
                    style={{ cursor: "text" }}
                    onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                  >
                    {cat.name}
                  </span>
                )}
                <div className="d-flex align-items-center gap-2">
                  {deleteError[cat.id] && <small className="text-danger">{deleteError[cat.id]}</small>}
                  {deletingId === cat.id ? (
                    <>
                      <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Confirm</button>
                      <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setDeletingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
    return wrapperClass ? <div className={wrapperClass}>{card}</div> : card;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Categories</h1>
        <a href={`/budgets/${budget_pk}/`} className="btn btn-outline-secondary btn-sm">← Back to Budget</a>
      </div>

      {showForm && (
        <div className="card mb-4">
          <div className="card-body">
            <form onSubmit={(e) => void handleCreate(e)}>
              <div className="row g-2 align-items-end">
                <div className="col-auto">
                  <select className="form-select form-select-sm" value={newType} onChange={(e) => setNewType(e.target.value as "income" | "expense")}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                <div className="col">
                  <input
                    className="form-control form-control-sm"
                    placeholder="Category name"
                    value={newName}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="col-auto">
                  <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                  <button type="button" className="btn btn-outline-secondary btn-sm ms-2" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </div>
              {formError && <div className="text-danger small mt-1">{formError}</div>}
            </form>
          </div>
        </div>
      )}

      <div className="row g-4">
        {renderSection(expense, "Expense", "danger")}
        <div className="col-md-6 d-flex flex-column gap-4">
          {renderSection(income, "Income", "success", "")}

          {/* Sinking Funds */}
          <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center bg-warning bg-opacity-10">
            <span className="small fw-bold text-warning-emphasis">Sinking Funds</span>
            <button
              className="btn btn-outline-warning btn-sm py-0 px-2"
              style={{ fontSize: "0.75rem" }}
              onClick={() => setShowSinkingFundForm(true)}
            >
              + Add
            </button>
          </div>

          {showSinkingFundForm && (
            <div className="card-body border-bottom">
              <form onSubmit={(e) => void handleCreateSinkingFund(e)}>
                <div className="row g-2 align-items-end">
                  <div className="col-md-4">
                    <label className="form-label small mb-1">Name</label>
                    <input
                      className="form-control form-control-sm"
                      placeholder="e.g. Vacation, New Car"
                      value={newSFName}
                      autoFocus
                      onChange={(e) => setNewSFName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small mb-1">Target amount</label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text">$</span>
                      <input
                        type="number" className="form-control" min="0.01" step="0.01"
                        placeholder="5000"
                        value={newSFTarget}
                        onChange={(e) => setNewSFTarget(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="col-md-2 d-flex align-items-end pb-1">
                    <div className="form-check form-switch mb-0">
                      <input
                        className="form-check-input" type="checkbox" role="switch"
                        id="new-sf-ongoing"
                        checked={newSFOngoing}
                        onChange={(e) => setNewSFOngoing(e.target.checked)}
                      />
                      <label className="form-check-label small" htmlFor="new-sf-ongoing">Ongoing</label>
                    </div>
                  </div>
                  {!newSFOngoing ? (
                    <div className="col-md-2">
                      <label className="form-label small mb-1">Due date</label>
                      <input
                        type="date" className="form-control form-control-sm"
                        value={newSFDueDate}
                        onChange={(e) => setNewSFDueDate(e.target.value)}
                        required={!newSFOngoing}
                      />
                    </div>
                  ) : (
                    <div className="col-md-2">
                      <label className="form-label small mb-1">Monthly goal</label>
                      <div className="input-group input-group-sm">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" className="form-control" min="0" step="0.01"
                          placeholder="100"
                          value={newSFMonthlyGoal}
                          onChange={(e) => setNewSFMonthlyGoal(e.target.value)}
                          required={newSFOngoing}
                        />
                      </div>
                    </div>
                  )}
                  <div className="col-md-2">
                    <label className="form-label small mb-1">Already saved <span className="text-muted fw-normal">(optional)</span></label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text">$</span>
                      <input
                        type="number" className="form-control" min="0" step="0.01"
                        placeholder="0"
                        value={newSFInitial}
                        onChange={(e) => setNewSFInitial(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="col-md-2 d-flex gap-1 align-items-end">
                    <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowSinkingFundForm(false)}>Cancel</button>
                  </div>
                </div>
                {sfFormError && <div className="text-danger small mt-1">{sfFormError}</div>}
              </form>
            </div>
          )}

          {sinkingFunds.length === 0 && !showSinkingFundForm ? (
            <div className="card-body text-muted small">No sinking funds yet. Add one to save toward a goal.</div>
          ) : (
            <ul className="list-group list-group-flush">
              {sinkingFunds.map((cat) => {
                const saved = parseFloat(cat.total_saved ?? "0");
                const target = parseFloat(cat.sinking_fund_target ?? "0");
                const pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
                const isEditing = editingSFId === cat.id;
                return (
                  <li key={cat.id} className="list-group-item py-2 px-3">
                    {isEditing ? (
                      <form onSubmit={(e) => void handleSFEdit(e)}>
                        <div className="row g-2 align-items-end">
                          <div className="col-md-4">
                            <label className="form-label small mb-1">Name</label>
                            <input className="form-control form-control-sm" value={editSFName} onChange={(e) => setEditSFName(e.target.value)} required />
                          </div>
                          <div className="col-md-3">
                            <label className="form-label small mb-1">Target</label>
                            <div className="input-group input-group-sm">
                              <span className="input-group-text">$</span>
                              <input type="number" className="form-control" min="0.01" step="0.01" value={editSFTarget} onChange={(e) => setEditSFTarget(e.target.value)} required />
                            </div>
                          </div>
                          <div className="col-auto d-flex align-items-end pb-1">
                            <div className="form-check form-switch mb-0">
                              <input
                                className="form-check-input" type="checkbox" role="switch"
                                id={`edit-sf-ongoing-${cat.id}`}
                                checked={editSFOngoing}
                                onChange={(e) => setEditSFOngoing(e.target.checked)}
                              />
                              <label className="form-check-label small" htmlFor={`edit-sf-ongoing-${cat.id}`}>Ongoing</label>
                            </div>
                          </div>
                          {!editSFOngoing ? (
                            <div className="col-md-3">
                              <label className="form-label small mb-1">Due date</label>
                              <input type="date" className="form-control form-control-sm" value={editSFDueDate} onChange={(e) => setEditSFDueDate(e.target.value)} required={!editSFOngoing} />
                            </div>
                          ) : (
                            <div className="col-md-3">
                              <label className="form-label small mb-1">Monthly goal</label>
                              <div className="input-group input-group-sm">
                                <span className="input-group-text">$</span>
                                <input type="number" className="form-control" min="0" step="0.01" placeholder="100" value={editSFMonthlyGoal} onChange={(e) => setEditSFMonthlyGoal(e.target.value)} required={editSFOngoing} />
                              </div>
                            </div>
                          )}
                          <div className="col-12 mt-1">
                            <div className="row g-2 align-items-end">
                              <div className="col-md-3">
                                <label className="form-label small mb-1">Add to balance <span className="text-muted fw-normal">(optional)</span></label>
                                <div className="input-group input-group-sm">
                                  <span className="input-group-text">$</span>
                                  <input type="number" className="form-control" min="0.01" step="0.01" placeholder="0.00" value={editSFAddAmount} onChange={(e) => setEditSFAddAmount(e.target.value)} />
                                </div>
                              </div>
                              {editSFAddAmount && parseFloat(editSFAddAmount) > 0 && (
                                <div className="col-md-5">
                                  <label className="form-label small mb-1">Description</label>
                                  <input className="form-control form-control-sm" placeholder="e.g. Initial deposit" value={editSFAddDesc} onChange={(e) => setEditSFAddDesc(e.target.value)} />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="col-12 d-flex gap-1 mt-1">
                            <button className="btn btn-primary btn-sm" disabled={editSFSaving}>Save</button>
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditingSFId(null)}>Cancel</button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1 me-3">
                          <div className="fw-medium">
                            {cat.name}
                            {cat.sinking_fund_ongoing && <span className="badge bg-secondary ms-2" style={{ fontSize: "0.65rem" }}>ongoing</span>}
                          </div>
                          <div className="text-muted small">
                            ${saved.toFixed(2)} saved of ${target.toFixed(2)}
                            {cat.sinking_fund_ongoing && cat.sinking_fund_monthly_goal && parseFloat(cat.sinking_fund_monthly_goal) > 0
                              ? <> · ${parseFloat(cat.sinking_fund_monthly_goal).toFixed(2)}/mo goal</>
                              : cat.sinking_fund_due_date
                                ? <> · Due {new Date(cat.sinking_fund_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</>
                                : null
                            }
                          </div>
                          <div className="progress mt-1" style={{ height: 4, maxWidth: 200 }}>
                            <div className={`progress-bar ${pct >= 100 ? "bg-success" : "bg-warning"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-2 flex-shrink-0">
                          {deleteError[cat.id] && <small className="text-danger">{deleteError[cat.id]}</small>}
                          {deletingId === cat.id ? (
                            <>
                              <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Confirm</button>
                              <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setDeletingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => { setEditingSFId(cat.id); setEditSFName(cat.name); setEditSFTarget(cat.sinking_fund_target ?? ""); setEditSFDueDate(cat.sinking_fund_due_date ?? ""); setEditSFOngoing(cat.sinking_fund_ongoing); setEditSFMonthlyGoal(cat.sinking_fund_monthly_goal ?? ""); setEditSFAddAmount(""); setEditSFAddDesc(""); }}>Edit</button>
                              <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
