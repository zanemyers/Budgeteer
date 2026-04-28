import { useState } from "react";

interface CategoryType {
  id: number;
  name: string;
  category_type: "income" | "expense";
  monthly_budget: string;
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
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"income" | "expense">("expense");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  const income = categories.filter((c) => c.category_type === "income");
  const expense = categories.filter((c) => c.category_type === "expense");

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

  function renderSection(sectionCategories: CategoryType[], label: string, colorClass: string) {
    return (
      <div className="col-md-6">
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
      </div>
    );
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
        {renderSection(income, "Income", "success")}
      </div>
    </div>
  );
}
