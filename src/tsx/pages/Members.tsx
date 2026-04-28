import { useState } from "react";

interface Membership {
  id: number;
  user: number;
  email: string;
  name: string;
  role: string;
  gravatar_url: string;
  joined_at: string;
}

interface RoleChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  memberships: Membership[];
  role_choices: RoleChoice[];
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

export default function Members({ budget_pk, memberships: initialMemberships, role_choices }: Props) {
  const [memberships, setMemberships] = useState(initialMemberships);
  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(role_choices[0]?.value ?? "member");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<Record<number, string>>({});

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const m = await apiFetch(`/budgets/${budget_pk}/members/invite/`, "POST", {
        email: inviteEmail,
        role: inviteRole,
      }) as Membership;
      setMemberships((prev) => [...prev, m]);
      setInviteEmail("");
      setShowForm(false);
    } catch (err) {
      const e = err as Record<string, string[]>;
      setFormError(Object.values(e).flat().join(" "));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(m: Membership) {
    if (removingId !== m.id) { setRemovingId(m.id); return; }
    try {
      await apiFetch(`/budgets/${budget_pk}/members/${m.id}/remove/`, "DELETE");
      setMemberships((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      const e = err as Record<string, string | string[]>;
      const msg = typeof e.detail === "string" ? e.detail : Object.values(e).flat().join(" ");
      setRemoveError((prev) => ({ ...prev, [m.id]: msg }));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Members</h1>
        <div className="d-flex gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Invite</button>
          <a href={`/budgets/${budget_pk}/`} className="btn btn-outline-secondary btn-sm">← Back to Budget</a>
        </div>
      </div>

      {showForm && (
        <div className="card mb-4">
          <div className="card-body">
            <form onSubmit={(e) => void handleInvite(e)}>
              <div className="row g-2 align-items-end">
                <div className="col">
                  <input
                    className="form-control form-control-sm"
                    placeholder="Email address"
                    type="email"
                    value={inviteEmail}
                    autoFocus
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="col-auto">
                  <select
                    className="form-select form-select-sm"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {role_choices.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <button className="btn btn-primary btn-sm" disabled={saving}>Invite</button>
                  <button type="button" className="btn btn-outline-secondary btn-sm ms-2" onClick={() => { setShowForm(false); setFormError(""); }}>Cancel</button>
                </div>
              </div>
              {formError && <div className="text-danger small mt-1">{formError}</div>}
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <ul className="list-group list-group-flush">
          {memberships.map((m) => (
            <li key={m.id} className="list-group-item d-flex justify-content-between align-items-center py-3">
              <div className="d-flex align-items-center gap-3">
                <img src={m.gravatar_url} alt="" className="rounded-circle" width={36} height={36} />
                <div>
                  <div className="fw-semibold">{m.name}</div>
                  <div className="text-muted small">{m.email}</div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-3">
                <span className="badge bg-secondary text-capitalize">{m.role}</span>
                {removeError[m.id] && <small className="text-danger">{removeError[m.id]}</small>}
                {removingId === m.id ? (
                  <>
                    <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleRemove(m)}>Confirm</button>
                    <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setRemovingId(null)}>Cancel</button>
                  </>
                ) : (
                  <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleRemove(m)}>Remove</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
