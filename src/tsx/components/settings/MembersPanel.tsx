import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jsonFetch } from "@/lib/api";

export interface Membership {
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
  budgetPk: number;
  memberships: Membership[];
  roleChoices: RoleChoice[];
  onChange: (next: Membership[]) => void;
}

export function MembersPanel({ budgetPk, memberships, roleChoices, onChange }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(roleChoices[0]?.value ?? "member");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removeError, setRemoveError] = useState<Record<number, string>>({});

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const m = await jsonFetch<Membership>(`/budgets/${budgetPk}/members/invite/`, "POST", {
        email: inviteEmail,
        role: inviteRole,
      });
      if (m) onChange([...memberships, m]);
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
    try {
      await jsonFetch(`/budgets/${budgetPk}/members/${m.id}/remove/`, "DELETE");
      onChange(memberships.filter((x) => x.id !== m.id));
    } catch (err) {
      const e = err as Record<string, string | string[]>;
      const msg = typeof e.detail === "string" ? e.detail : Object.values(e).flat().join(" ");
      setRemoveError((prev) => ({ ...prev, [m.id]: msg }));
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold">Members</h2>
        <Button size="sm" onClick={() => setShowForm(true)}>
          + Invite
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4">
          <CardContent>
            <form onSubmit={(e) => void handleInvite(e)}>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label="Invite by email address"
                    placeholder="Email address"
                    type="email"
                    value={inviteEmail}
                    autoFocus
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger aria-label="Role for the invited member">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleChoices.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={saving}>
                  Invite
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setFormError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
              {formError && <p className="text-destructive text-sm mt-2">{formError}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {memberships.length === 0 ? (
        <Card>
          <CardContent className="text-center py-10">
            <p className="text-sm text-muted-foreground">No members yet.</p>
            <button
              type="button"
              className="text-sm text-primary hover:underline mt-1 cursor-pointer"
              onClick={() => setShowForm(true)}
            >
              + Invite your first
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {memberships.map((m) => (
            <div
              key={m.id}
              className="flex justify-between items-center gap-4 p-3 rounded-lg border border-border-strong bg-card shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img src={m.gravatar_url} alt="" className="rounded-full size-9 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-muted-foreground text-sm truncate">{m.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant="secondary" className="capitalize">
                  {m.role}
                </Badge>
                {removeError[m.id] && <small className="text-destructive">{removeError[m.id]}</small>}
                {m.role !== "owner" && <ConfirmButton onConfirm={() => handleRemove(m)} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
