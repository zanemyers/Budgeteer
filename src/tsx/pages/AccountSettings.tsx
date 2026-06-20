import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfToken } from "@/lib/api";

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

const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "America/Adak", "Pacific/Honolulu",
  "America/Puerto_Rico", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Shanghai",
  "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function CurrencyTab({ currency: initialCurrency, currencies }: { currency: string; currencies: CurrencyOption[] }) {
  const [currency, setCurrency] = useState(initialCurrency);
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
        body: JSON.stringify({ action: "update_currency", currency }),
      });
      if (res.ok) setSuccess(true);
      else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Something went wrong.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
      {success && <Alert variant="success"><AlertDescription>Currency updated.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {currencies.length === 0 ? (
        <p className="text-muted-foreground text-sm">No currencies loaded yet. An API key is required.</p>
      ) : (
        <div className="flex gap-2 items-start">
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </form>
  );
}

function AvatarForm({ avatarUrl: initialAvatar }: { avatarUrl: string }) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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
    <div className="flex items-center gap-4">
      <img
        src={avatarPreview ?? avatarUrl}
        alt="Avatar"
        width={64}
        height={64}
        className="rounded-full object-cover size-16"
      />
      <div>
        <Button asChild variant="outline" size="sm">
          <label className="cursor-pointer">
            {avatarUploading ? "Uploading…" : "Change photo"}
            <input type="file" accept="image/*" className="hidden" onChange={onFileChange} disabled={avatarUploading} />
          </label>
        </Button>
        {avatarError && <p className="text-destructive text-sm mt-1">{avatarError}</p>}
      </div>
    </div>
  );
}

function TimezoneForm({ timezone: initialTz }: { timezone: string }) {
  const [tz, setTz] = useState(initialTz);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSuccess, setTzSuccess] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);

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

  const tzOptions = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [...COMMON_TIMEZONES, tz];

  return (
    <form onSubmit={(e) => void saveTz(e)} className="flex flex-col gap-3">
      {tzSuccess && <Alert variant="success"><AlertDescription>Timezone updated.</AlertDescription></Alert>}
      {tzError && <Alert variant="destructive"><AlertDescription>{tzError}</AlertDescription></Alert>}
      <div className="flex gap-3 items-end">
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {tzOptions.map((t) => (
              <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={tzSaving}>{tzSaving ? "Saving…" : "Save"}</Button>
      </div>
    </form>
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
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
      {success && <Alert variant="success"><AlertDescription>Name updated.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex gap-3 items-end">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <Label htmlFor="first-name" className="text-xs text-muted-foreground">First</Label>
          <Input id="first-name" value={fn} onChange={(e) => setFn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <Label htmlFor="last-name" className="text-xs text-muted-foreground">Last</Label>
          <Input id="last-name" value={ln} onChange={(e) => setLn(e.target.value)} />
        </div>
        <Button disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
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
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
      {success && <Alert variant="success"><AlertDescription>Password changed.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-pw" className="text-xs text-muted-foreground">Current password</Label>
        <Input id="current-pw" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-pw" className="text-xs text-muted-foreground">New password</Label>
        <Input id="new-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-pw" className="text-xs text-muted-foreground">Confirm new password</Label>
        <Input id="confirm-pw" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
      </div>
      <Button className="self-start mt-1" disabled={saving}>{saving ? "Saving…" : "Change password"}</Button>
    </form>
  );
}

function EmailTab({ addresses, setAddresses }: { addresses: EmailAddress[]; setAddresses: React.Dispatch<React.SetStateAction<EmailAddress[]>> }) {
  const [busy, setBusy] = useState<number | null>(null);
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
    await patch({ action: "remove_email", email: addr.email });
    setAddresses((prev) => prev.filter((a) => a.id !== addr.id));
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {addresses.map((addr) => (
          <div key={addr.id} className="flex justify-between items-start gap-3 p-3 rounded-lg border border-border-strong bg-card shadow-sm">
            <div>
              <div className="font-medium">{addr.email}</div>
              <div className="flex gap-1.5 mt-1.5">
                {addr.primary && <Badge variant="success">Primary</Badge>}
                {addr.verified
                  ? <Badge variant="success">Verified</Badge>
                  : <Badge variant="warning">Unverified</Badge>}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {!addr.verified && (
                <Button variant="outline" size="sm" disabled={busy === addr.id} onClick={() => void resend(addr)}>
                  {busy === addr.id ? "Sending…" : "Resend"}
                </Button>
              )}
              {!addr.primary && (
                <Button variant="outline" size="sm" disabled={busy === addr.id} onClick={() => void makePrimary(addr)}>
                  Make primary
                </Button>
              )}
              {!addr.primary && (
                <ConfirmButton onConfirm={() => remove(addr)} />
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd ? (
        <form onSubmit={(e) => void addEmail(e)} className="flex gap-2 items-start">
          <div className="grow">
            <Input
              type="email"
              placeholder="new@example.com"
              value={newEmail}
              autoFocus
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            {addError && <p className="text-destructive text-sm mt-1">{addError}</p>}
          </div>
          <Button size="sm" disabled={adding}>{adding ? "Adding…" : "Add"}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setShowAdd(false); setAddError(""); }}>Cancel</Button>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setShowAdd(true)}>+ Add email address</Button>
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
    const res = await fetch("/accounts/settings/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify({ action: "remove_simplefin_connection", id: conn.id }),
    });
    if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== conn.id));
  }

  function statusVariant(status: string): "success" | "destructive-subtle" | "warning" {
    if (status === "ok") return "success";
    if (status === "error") return "destructive-subtle";
    return "warning";
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex justify-between items-start gap-3 mb-2 flex-wrap">
          <h6 className="text-sm font-semibold">SimpleFIN Bridge</h6>
          <Button asChild variant="outline" size="sm">
            <a href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">
              Open SimpleFIN Bridge ↗
            </a>
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Sign in at SimpleFIN Bridge, link your bank accounts, then generate a setup token and paste it below.
          The token is exchanged for an access URL once and stored encrypted.
        </p>
      </section>

      {connections.length > 0 && (
        <div className="flex flex-col gap-2">
          {connections.map((c) => (
            <div key={c.id} className="flex justify-between items-start gap-3 p-3 rounded-lg border border-border-strong bg-card shadow-sm">
              <div>
                <div className="font-medium">{c.label || `Connection #${c.id}`}</div>
                <div className="flex gap-2 mt-1.5 items-center flex-wrap">
                  <Badge variant={statusVariant(c.last_sync_status)}>{c.last_sync_status}</Badge>
                  <span className="text-muted-foreground text-sm">
                    {c.last_synced_at ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}` : "Never synced"}
                  </span>
                </div>
                {c.last_sync_error && <p className="text-destructive text-sm mt-1">{c.last_sync_error}</p>}
              </div>
              <ConfirmButton onConfirm={() => remove(c)} />
            </div>
          ))}
        </div>
      )}

      <form onSubmit={(e) => void claim(e)} className="flex flex-col gap-4">
        {success && <Alert variant="success"><AlertDescription>Connection added.</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="sf-label">Label (optional)</Label>
          <Input id="sf-label" placeholder="e.g. Personal banks" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sf-token">Setup token</Label>
          <Textarea
            id="sf-token"
            className="font-mono text-sm"
            rows={4}
            placeholder="Paste the base64 setup token from SimpleFIN Bridge"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <p className="text-muted-foreground text-sm">
            Tokens are one-shot — once claimed, they cannot be reused.
          </p>
        </div>
        <Button className="self-start" disabled={submitting || !token}>
          {submitting ? "Claiming…" : "Add connection"}
        </Button>
      </form>
    </div>
  );
}

export default function AccountSettings({ first_name, last_name, email_addresses, timezone, avatar_url, currency, currencies, simplefin_connections }: Props) {
  const [firstName, setFirstName] = useState(first_name);
  const [lastName, setLastName] = useState(last_name);
  const [addresses, setAddresses] = useState(email_addresses);
  const [connections, setConnections] = useState(simplefin_connections);

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Account Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Profile, password, currency, and bank connections.
        </p>
      </header>

      <div>
        <SettingsRow label="Avatar" description="Shown next to your name in shared budgets.">
          <AvatarForm avatarUrl={avatar_url} />
        </SettingsRow>
        <SettingsRow label="Name" description="How you appear to other budget members.">
          <NameTab
            firstName={firstName}
            lastName={lastName}
            onSaved={(fn, ln) => { setFirstName(fn); setLastName(ln); }}
          />
        </SettingsRow>
        <SettingsRow label="Timezone" description="Used for due dates and report ranges.">
          <TimezoneForm timezone={timezone} />
        </SettingsRow>
        <SettingsRow label="Email addresses" description="Primary email is used for sign-in and password resets.">
          <EmailTab addresses={addresses} setAddresses={setAddresses} />
        </SettingsRow>
        <SettingsRow label="Password" description="Use a unique password you don't reuse elsewhere.">
          <PasswordTab />
        </SettingsRow>
        <SettingsRow label="Currency" description="All transactions display in this currency. Foreign-currency entries convert at the daily rate.">
          <CurrencyTab currency={currency} currencies={currencies} />
        </SettingsRow>
        <SettingsRow label="SimpleFIN" description="Connect a SimpleFIN bridge to pull live account balances and recent transactions.">
          <BankTab connections={connections} setConnections={setConnections} />
        </SettingsRow>
      </div>
    </div>
  );
}
