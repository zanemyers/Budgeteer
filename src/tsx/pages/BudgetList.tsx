import { useState } from "react";
import { router } from "@inertiajs/react";

interface Budget {
  id: number;
  name: string;
  created_at: string;
  is_owner: boolean;
}

interface Props {
  budgets: Budget[];
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function displayName(budget: Budget): string {
  return budget.name || `Budget #${budget.id}`;
}

export default function BudgetList({ budgets: initial }: Props) {
  const [budgets, setBudgets] = useState(initial);
  const [editingName, setEditingName] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function createBudget() {
    if (newName === null) return;
    setCreating(true);
    try {
      const res = await fetch("/budgets/create/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const { id } = await res.json() as { id: number };
        router.visit(`/budgets/${id}/`);
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveName(budget: Budget) {
    const val = editingName[budget.id];
    setEditingName((prev) => { const n = { ...prev }; delete n[budget.id]; return n; });
    if (val === undefined || val === budget.name) return;
    setSavingId(budget.id);
    try {
      const res = await fetch(`/budgets/${budget.id}/edit/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ name: val }),
      });
      if (res.ok) {
        const updated = await res.json() as { id: number; name: string };
        setBudgets((prev) => prev.map((b) => b.id === updated.id ? { ...b, name: updated.name } : b));
      }
    } finally {
      setSavingId(null);
    }
  }

  async function deleteBudget(id: number) {
    setDeletingId(id);
    try {
      await fetch(`/budgets/${id}/delete/`, {
        method: "DELETE",
        headers: { "X-CSRFToken": getCsrfToken() },
      });
      setBudgets((prev) => prev.filter((b) => b.id !== id));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="py-2" style={{ maxWidth: 640 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">My Budgets</h1>
        {newName === null && (
          <button className="btn btn-primary" onClick={() => setNewName("")}>
            New Budget
          </button>
        )}
      </div>

      {newName !== null && (
        <div className="card mb-3">
          <div className="card-body">
            <label className="form-label fw-semibold">Budget name</label>
            <div className="d-flex gap-2">
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Vacation 2025"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createBudget();
                  if (e.key === "Escape") setNewName(null);
                }}
              />
              <button className="btn btn-primary" disabled={creating} onClick={() => void createBudget()}>
                {creating ? "Creating…" : "Create"}
              </button>
              <button className="btn btn-outline-secondary" onClick={() => setNewName(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {budgets.length === 0 && newName === null ? (
        <div className="text-center py-5 text-muted">
          <p className="mb-3">You don&apos;t have any budgets yet.</p>
          <button className="btn btn-primary" onClick={() => setNewName("")}>
            Create your first budget
          </button>
        </div>
      ) : budgets.length > 0 ? (
        <div className="list-group">
          {budgets.map((budget) => {
            const isEditing = budget.id in editingName;
            const isConfirming = confirmDeleteId === budget.id;
            const isDeleting = deletingId === budget.id;
            const isSaving = savingId === budget.id;

            return (
              <div key={budget.id} className="list-group-item d-flex align-items-center gap-3">
                {/* Name / editable input */}
                <div className="flex-grow-1 min-w-0">
                  {isEditing ? (
                    <input
                      className="form-control form-control-sm"
                      value={editingName[budget.id]}
                      autoFocus
                      onChange={(e) =>
                        setEditingName((prev) => ({ ...prev, [budget.id]: e.target.value }))
                      }
                      onBlur={() => void saveName(budget)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveName(budget);
                        if (e.key === "Escape")
                          setEditingName((prev) => {
                            const n = { ...prev };
                            delete n[budget.id];
                            return n;
                          });
                      }}
                    />
                  ) : (
                    <>
                      <a
                        href={`/budgets/${budget.id}/`}
                        className="fw-semibold text-decoration-none text-body d-block"
                        onClick={(e) => {
                          e.preventDefault();
                          router.visit(`/budgets/${budget.id}/`);
                        }}
                      >
                        {displayName(budget)}
                      </a>
                      <span className="text-muted small">Created {fmtDate(budget.created_at)}</span>
                    </>
                  )}
                </div>

                {/* Actions */}
                {budget.is_owner && (
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {isConfirming ? (
                      <>
                        <span className="small text-muted">Delete?</span>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={isDeleting}
                          onClick={() => void deleteBudget(budget.id)}
                        >
                          {isDeleting ? "…" : "Yes"}
                        </button>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          disabled={isSaving || isEditing}
                          onClick={() =>
                            setEditingName((prev) => ({
                              ...prev,
                              [budget.id]: budget.name,
                            }))
                          }
                        >
                          {isSaving ? "…" : "Rename"}
                        </button>
                        <button
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => setConfirmDeleteId(budget.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
