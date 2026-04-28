import { useState } from "react";

interface PaymentMethod {
  id: number;
  name: string;
  payment_type: string;
  payment_type_display: string;
  last_four: string;
  is_active: boolean;
}

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  payment_methods: PaymentMethod[];
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

export default function PaymentMethods({ payment_methods: initialMethods, type_choices }: Props) {
  const [methods, setMethods] = useState(initialMethods);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(type_choices[0]?.value ?? "");
  const [newLastFour, setNewLastFour] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<PaymentMethod>>({});
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const pm = await apiFetch("/accounts/payment-methods/", "POST", {
        name: newName,
        payment_type: newType,
        last_four: newLastFour,
      }) as PaymentMethod;
      setMethods((prev) => [...prev, pm]);
      setNewName("");
      setNewLastFour("");
      setShowForm(false);
    } catch (err) {
      const e = err as Record<string, string[]>;
      setFormError(Object.values(e).flat().join(" "));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(pm: PaymentMethod) {
    setEditingId(pm.id);
    setEditValues({ name: pm.name, payment_type: pm.payment_type, last_four: pm.last_four, is_active: pm.is_active });
  }

  async function handleSaveEdit(pm: PaymentMethod) {
    try {
      const updated = await apiFetch(`/accounts/payment-methods/${pm.id}/`, "PATCH", editValues) as PaymentMethod;
      setMethods((prev) => prev.map((m) => (m.id === pm.id ? updated : m)));
    } finally {
      setEditingId(null);
    }
  }

  async function handleDelete(pm: PaymentMethod) {
    if (deletingId !== pm.id) { setDeletingId(pm.id); return; }
    try {
      await apiFetch(`/accounts/payment-methods/${pm.id}/`, "DELETE");
      setMethods((prev) => prev.filter((m) => m.id !== pm.id));
    } catch {
      setDeleteError((prev) => ({ ...prev, [pm.id]: "Cannot delete — payment method is in use." }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Payment Methods</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add</button>
      </div>

      {showForm && (
        <div className="card mb-4">
          <div className="card-body">
            <form onSubmit={(e) => void handleCreate(e)}>
              <div className="row g-2 align-items-end">
                <div className="col">
                  <input
                    className="form-control form-control-sm"
                    placeholder="Name (e.g. Chase Sapphire)"
                    value={newName}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="col-auto">
                  <select
                    className="form-select form-select-sm"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                  >
                    {type_choices.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-auto" style={{ width: "100px" }}>
                  <input
                    className="form-control form-control-sm"
                    placeholder="Last 4"
                    maxLength={4}
                    value={newLastFour}
                    onChange={(e) => setNewLastFour(e.target.value)}
                  />
                </div>
                <div className="col-auto">
                  <button className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                  <button type="button" className="btn btn-outline-secondary btn-sm ms-2" onClick={() => { setShowForm(false); setFormError(""); }}>Cancel</button>
                </div>
              </div>
              {formError && <div className="text-danger small mt-1">{formError}</div>}
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {methods.length === 0 ? (
          <div className="card-body text-muted small">No payment methods yet.</div>
        ) : (
          <ul className="list-group list-group-flush">
            {methods.map((pm) => (
              <li key={pm.id} className="list-group-item py-2">
                {editingId === pm.id ? (
                  <div className="row g-2 align-items-center">
                    <div className="col">
                      <input
                        className="form-control form-control-sm"
                        value={editValues.name ?? ""}
                        autoFocus
                        onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingId(null); }}
                      />
                    </div>
                    <div className="col-auto">
                      <select
                        className="form-select form-select-sm"
                        value={editValues.payment_type ?? ""}
                        onChange={(e) => setEditValues((v) => ({ ...v, payment_type: e.target.value }))}
                      >
                        {type_choices.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-auto" style={{ width: "100px" }}>
                      <input
                        className="form-control form-control-sm"
                        placeholder="Last 4"
                        maxLength={4}
                        value={editValues.last_four ?? ""}
                        onChange={(e) => setEditValues((v) => ({ ...v, last_four: e.target.value }))}
                      />
                    </div>
                    <div className="col-auto">
                      <div className="form-check form-check-inline mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`active-${pm.id}`}
                          checked={editValues.is_active ?? true}
                          onChange={(e) => setEditValues((v) => ({ ...v, is_active: e.target.checked }))}
                        />
                        <label className="form-check-label small" htmlFor={`active-${pm.id}`}>Active</label>
                      </div>
                    </div>
                    <div className="col-auto">
                      <button className="btn btn-primary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleSaveEdit(pm)}>Save</button>
                      <button className="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" style={{ fontSize: "0.75rem" }} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="d-flex justify-content-between align-items-center">
                    <div
                      className="d-flex align-items-center gap-2"
                      style={{ cursor: "text" }}
                      onClick={() => startEdit(pm)}
                    >
                      <span className="fw-semibold">{pm.name}</span>
                      <span className="text-muted small">{pm.payment_type_display}{pm.last_four && ` ···· ${pm.last_four}`}</span>
                      {!pm.is_active && <span className="badge bg-secondary">Inactive</span>}
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      {deleteError[pm.id] && <small className="text-danger">{deleteError[pm.id]}</small>}
                      {deletingId === pm.id ? (
                        <>
                          <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(pm)}>Confirm</button>
                          <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setDeletingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(pm)}>Delete</button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
