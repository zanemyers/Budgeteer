import { useState } from "react";

interface EmailAddress {
  id: number;
  email: string;
  primary: boolean;
  verified: boolean;
}

interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

interface SimpleFINConnection {
  id: number;
  label: string;
  last_synced_at: string | null;
  last_sync_status: string;
  last_sync_error: string;
  created_at: string;
}

interface Props {
  first_name: string;
  last_name: string;
  email_addresses: EmailAddress[];
  timezone: string;
  avatar_url: string;
  currency: string;
  currencies: CurrencyOption[];
  simplefin_connections: SimpleFINConnection[];
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

type Tab = "profile" | "name" | "password" | "email" | "bank";

const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "America/Adak", "Pacific/Honolulu",
  "America/Puerto_Rico", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Shanghai",
  "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function ProfileTab({ timezone: initialTz, avatarUrl: initialAvatar, currency: initialCurrency, currencies }: { timezone: string; avatarUrl: string; currency: string; currencies: CurrencyOption[] }) {
  const [currency, setCurrency] = useState(initialCurrency);
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencySuccess, setCurrencySuccess] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [tz, setTz] = useState(initialTz);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSuccess, setTzSuccess] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function saveCurrency(e: React.FormEvent) {
    e.preventDefault();
    setCurrencySaving(true);
    setCurrencySuccess(false);
    setCurrencyError(null);
    try {
      const res = await fetch("/accounts/settings/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ action: "update_currency", currency }),
      });
      if (res.ok) setCurrencySuccess(true);
      else {
        const data = await res.json() as { error?: string };
        setCurrencyError(data.error ?? "Something went wrong.");
      }
    } finally {
      setCurrencySaving(false);
    }
  }

  async function saveTz(e: React.FormEvent) {
    e.preventDefault();
    setTzSaving(true);
    setTzSuccess(false);
    setTzError(null);
    try {
      const res = await fetch("/accounts/settings/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ action: "update_timezone", timezone: tz }),
      });
      if (res.ok) setTzSuccess(true);
      else {
        const data = await res.json() as { error?: string };
        setTzError(data.error ?? "Something went wrong.");
      }
    } finally {
      setTzSaving(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    void uploadAvatar(file);
  }

  async function uploadAvatar(file: File) {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const res = await fetch("/accounts/avatar/", {
        method: "POST",
        headers: { "X-CSRFToken": getCsrfToken() },
        body: fd,
      });
      const data = await res.json() as { avatar_url?: string; error?: string };
      if (res.ok && data.avatar_url) {
        setAvatarUrl(data.avatar_url);
        setAvatarPreview(null);
      } else {
        setAvatarError(data.error ?? "Upload failed.");
        setAvatarPreview(null);
      }
    } finally {
      setAvatarUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h6 className="font-semibold mb-4">Avatar</h6>
        <div className="flex items-center gap-4">
          <img
            src={avatarPreview ?? avatarUrl}
            alt="Avatar"
            width="72"
            height="72"
            className="rounded-full object-cover"
            style={{ objectFit: "cover" }}
          />
          <div>
            <label className="btn btn-outline-secondary btn-sm" style={{ cursor: "pointer" }}>
              {avatarUploading ? "Uploading…" : "Change photo"}
              <input type="file" accept="image/*" className="hidden" onChange={onFileChange} disabled={avatarUploading} />
            </label>
            {avatarError && <div className="text-danger text-sm mt-1">{avatarError}</div>}
          </div>
        </div>
      </div>

      <div>
        <h6 className="font-semibold mb-4">Timezone</h6>
        <form onSubmit={(e) => void saveTz(e)}>
          {tzSuccess && <div className="alert alert-success py-2">Timezone updated.</div>}
          {tzError && <div className="alert alert-danger py-2">{tzError}</div>}
          <div className="flex gap-2 items-start">
            <select className="form-select" value={tz} onChange={(e) => setTz(e.target.value)}>
              {COMMON_TIMEZONES.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
              {!COMMON_TIMEZONES.includes(tz) && <option value={tz}>{tz}</option>}
            </select>
            <button className="btn btn-primary shrink-0" disabled={tzSaving}>{tzSaving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>

      <div>
        <h6 className="font-semibold mb-4">Currency</h6>
        <form onSubmit={(e) => void saveCurrency(e)}>
          {currencySuccess && <div className="alert alert-success py-2">Currency updated.</div>}
          {currencyError && <div className="alert alert-danger py-2">{currencyError}</div>}
          {currencies.length === 0 ? (
            <p className="text-muted text-sm">No currencies loaded yet. An API key is required.</p>
          ) : (
            <div className="flex gap-2 items-start">
              <select className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                ))}
              </select>
              <button className="btn btn-primary shrink-0" disabled={currencySaving}>{currencySaving ? "Saving…" : "Save"}</button>
            </div>
          )}
          <p className="text-muted text-sm mt-2 mb-0">
            All transaction amounts are displayed in your preferred currency. When a transaction is recorded in a different currency, it is automatically converted using the exchange rate at the time of entry. Exchange rates are updated daily.
          </p>
        </form>
      </div>
    </div>
  );
}

function NameTab({
  firstName, lastName, onSaved,
}: {
  firstName: string;
  lastName: string;
  onSaved: (fn: string, ln: string) => void;
}) {
  const [fn, setFn] = useState(firstName);
  const [ln, setLn] = useState(lastName);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      const res = await fetch("/accounts/settings/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ first_name: fn, last_name: ln }),
      });
      if (res.ok) {
        setSuccess(true);
        onSaved(fn, ln);
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Something went wrong.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      {success && <div className="alert alert-success py-2">Name updated.</div>}
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="mb-4">
        <label className="form-label">First name</label>
        <input type="text" className="form-control" value={fn} onChange={(e) => setFn(e.target.value)} />
      </div>
      <div className="mb-4">
        <label className="form-label">Last name</label>
        <input type="text" className="form-control" value={ln} onChange={(e) => setLn(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
    </form>
  );
}

function PasswordTab() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      const res = await fetch("/accounts/settings/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ action: "change_password", old_password: oldPw, new_password: newPw, confirm_password: confirmPw }),
      });
      if (res.ok) {
        setSuccess(true);
        setOldPw(""); setNewPw(""); setConfirmPw("");
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Something went wrong.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      {success && <div className="alert alert-success py-2">Password changed.</div>}
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="mb-4">
        <label className="form-label">Current password</label>
        <input type="password" className="form-control" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
      </div>
      <div className="mb-4">
        <label className="form-label">New password</label>
        <input type="password" className="form-control" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
      </div>
      <div className="mb-4">
        <label className="form-label">Confirm new password</label>
        <input type="password" className="form-control" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Change Password"}</button>
    </form>
  );
}

function EmailTab({ addresses, setAddresses }: { addresses: EmailAddress[]; setAddresses: React.Dispatch<React.SetStateAction<EmailAddress[]>> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  async function patch(body: object) {
    const res = await fetch("/accounts/settings/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async function resend(addr: EmailAddress) {
    setBusy(addr.id);
    try { await patch({ action: "resend_verification", email: addr.email }); }
    finally { setBusy(null); }
  }

  async function makePrimary(addr: EmailAddress) {
    setBusy(addr.id);
    try {
      const data = await patch({ action: "make_primary", email: addr.email });
      if (data.email_addresses) setAddresses(data.email_addresses as EmailAddress[]);
    } finally { setBusy(null); }
  }

  async function remove(addr: EmailAddress) {
    if (confirmRemove !== addr.id) { setConfirmRemove(addr.id); return; }
    setBusy(addr.id);
    setConfirmRemove(null);
    try {
      await patch({ action: "remove_email", email: addr.email });
      setAddresses((prev) => prev.filter((a) => a.id !== addr.id));
    } finally { setBusy(null); }
  }

  async function addEmail(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/accounts/settings/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ action: "add_email", email: newEmail }),
      });
      const data = await res.json() as { id?: number; email?: string; primary?: boolean; verified?: boolean; error?: string };
      if (!res.ok) { setAddError(data.error ?? "Something went wrong."); return; }
      setAddresses((prev) => [...prev, data as EmailAddress]);
      setNewEmail("");
      setShowAdd(false);
    } finally { setAdding(false); }
  }

  return (
    <div>
      <div className="list-group mb-4">
        {addresses.map((addr) => (
          <div key={addr.id} className="list-group-item">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-semibold">{addr.email}</span>
                <div className="flex gap-2 mt-1">
                  {addr.primary && <span className="badge bg-primary-subtle text-primary-emphasis">Primary</span>}
                  {addr.verified
                    ? <span className="badge bg-success-subtle text-success-emphasis">Verified</span>
                    : <span className="badge bg-warning-subtle text-warning-emphasis">Unverified</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                {!addr.verified && (
                  <button className="btn btn-outline-secondary btn-sm" disabled={busy === addr.id} onClick={() => void resend(addr)}>
                    {busy === addr.id ? "Sending…" : "Resend"}
                  </button>
                )}
                {!addr.primary && (
                  <button className="btn btn-outline-primary btn-sm" disabled={busy === addr.id} onClick={() => void makePrimary(addr)}>
                    Make primary
                  </button>
                )}
                {!addr.primary && (
                  confirmRemove === addr.id ? (
                    <>
                      <button className="btn btn-danger btn-sm" disabled={busy === addr.id} onClick={() => void remove(addr)}>Confirm</button>
                      <button className="btn btn-outline-secondary btn-sm" onClick={() => setConfirmRemove(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-outline-danger btn-sm" onClick={() => void remove(addr)}>Remove</button>
                  )
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd ? (
        <form onSubmit={(e) => void addEmail(e)} className="flex gap-2 items-start">
          <div className="grow">
            <input
              type="email"
              className="form-control form-control-sm"
              placeholder="new@example.com"
              value={newEmail}
              autoFocus
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            {addError && <div className="text-danger text-sm mt-1">{addError}</div>}
          </div>
          <button className="btn btn-primary btn-sm" disabled={adding}>{adding ? "Adding…" : "Add"}</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setShowAdd(false); setAddError(""); }}>Cancel</button>
        </form>
      ) : (
        <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowAdd(true)}>+ Add email address</button>
      )}
    </div>
  );
}

function BankTab({ connections, setConnections }: { connections: SimpleFINConnection[]; setConnections: React.Dispatch<React.SetStateAction<SimpleFINConnection[]>> }) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/accounts/settings/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ action: "claim_simplefin_token", setup_token: token, label }),
      });
      const data = await res.json() as SimpleFINConnection & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not claim token.");
        return;
      }
      setConnections((prev) => [...prev, data]);
      setToken("");
      setLabel("");
      setSuccess(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(conn: SimpleFINConnection) {
    if (confirmRemove !== conn.id) { setConfirmRemove(conn.id); return; }
    setConfirmRemove(null);
    const res = await fetch("/accounts/settings/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify({ action: "remove_simplefin_connection", id: conn.id }),
    });
    if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== conn.id));
  }

  return (
    <div>
      <div className="mb-6">
        <h6 className="font-semibold mb-2">SimpleFIN Bridge</h6>
        <p className="text-muted text-sm mb-0">
          Link your bank accounts via <a href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">SimpleFIN Bridge</a>.
          After linking accounts there, generate a setup token and paste it below. The token is exchanged for an access URL once and stored encrypted.
        </p>
      </div>

      {connections.length > 0 && (
        <div className="list-group mb-6">
          {connections.map((c) => (
            <div key={c.id} className="list-group-item">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-semibold">{c.label || `Connection #${c.id}`}</span>
                  <div className="flex gap-2 mt-1 items-center">
                    <span className={`badge ${c.last_sync_status === "ok" ? "bg-success-subtle text-success-emphasis" : c.last_sync_status === "error" ? "bg-danger-subtle text-danger-emphasis" : "bg-warning-subtle text-warning-emphasis"}`}>
                      {c.last_sync_status}
                    </span>
                    <span className="text-muted text-sm">
                      {c.last_synced_at ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}` : "Never synced"}
                    </span>
                  </div>
                  {c.last_sync_error && <div className="text-danger text-sm mt-1">{c.last_sync_error}</div>}
                </div>
                <div className="flex gap-2">
                  {confirmRemove === c.id ? (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={() => void remove(c)}>Confirm</button>
                      <button className="btn btn-outline-secondary btn-sm" onClick={() => setConfirmRemove(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-outline-danger btn-sm" onClick={() => void remove(c)}>Remove</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={(e) => void claim(e)}>
        {success && <div className="alert alert-success py-2">Connection added.</div>}
        {error && <div className="alert alert-danger py-2">{error}</div>}
        <div className="mb-4">
          <label className="form-label">Label (optional)</label>
          <input
            type="text"
            className="form-control"
            placeholder="e.g. Personal banks"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="mb-4">
          <label className="form-label">Setup token</label>
          <textarea
            className="form-control font-mono text-sm"
            rows={4}
            placeholder="Paste the base64 setup token from SimpleFIN Bridge"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <p className="text-muted text-sm mt-1 mb-0">
            Tokens are one-shot — once claimed, they cannot be reused.
          </p>
        </div>
        <button className="btn btn-primary" disabled={submitting || !token}>
          {submitting ? "Claiming…" : "Add connection"}
        </button>
      </form>
    </div>
  );
}

const TAB_LABELS: Record<Tab, string> = { profile: "Profile", name: "Name", password: "Password", email: "Email", bank: "Bank Sync" };

export default function AccountSettings({ first_name, last_name, email_addresses, timezone, avatar_url, currency, currencies, simplefin_connections }: Props) {
  const [tab, setTab] = useState<Tab>("profile");
  const [firstName, setFirstName] = useState(first_name);
  const [lastName, setLastName] = useState(last_name);
  const [addresses, setAddresses] = useState(email_addresses);
  const [connections, setConnections] = useState(simplefin_connections);

  return (
    <div style={{ maxWidth: 540 }}>
      <h1 className="mb-6">Account Settings</h1>

      <ul className="nav nav-tabs mb-6">
        {(["profile", "name", "password", "email", "bank"] as Tab[]).map((t) => (
          <li className="nav-item" key={t}>
            <button
              type="button"
              className={`nav-link${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          </li>
        ))}
      </ul>

      {tab === "profile" && <ProfileTab timezone={timezone} avatarUrl={avatar_url} currency={currency} currencies={currencies} />}
      {tab === "name" && (
        <NameTab
          firstName={firstName}
          lastName={lastName}
          onSaved={(fn, ln) => { setFirstName(fn); setLastName(ln); }}
        />
      )}
      {tab === "password" && <PasswordTab />}
      {tab === "email" && <EmailTab addresses={addresses} setAddresses={setAddresses} />}
      {tab === "bank" && <BankTab connections={connections} setConnections={setConnections} />}
    </div>
  );
}
