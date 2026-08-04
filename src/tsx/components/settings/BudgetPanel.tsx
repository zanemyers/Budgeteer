import { router } from "@inertiajs/react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, jsonFetch } from "@/lib/api";

export interface BudgetSummary {
  pk: number;
  name: string;
  is_default: boolean;
  is_owner: boolean;
}

interface Props {
  budget: BudgetSummary;
  onChange: (next: BudgetSummary) => void;
}

export function BudgetPanel({ budget, onChange }: Props) {
  const [name, setName] = useState(budget.name);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);

  const dirty = name.trim() !== budget.name;

  async function saveName() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const data = (await jsonFetch(`/budgets/${budget.pk}/edit/`, "PATCH", { name: name.trim() })) as {
        name: string;
      };
      onChange({ ...budget, name: data.name });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(errorMessage(err, "Could not save budget name."));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault() {
    setSettingDefault(true);
    try {
      await jsonFetch(`/budgets/${budget.pk}/set-default/`, "POST");
      onChange({ ...budget, is_default: true });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't set this budget as default."));
    } finally {
      setSettingDefault(false);
    }
  }

  async function deleteBudget() {
    try {
      await jsonFetch(`/budgets/${budget.pk}/delete/`, "DELETE");
      router.visit("/budgets/");
    } catch (err) {
      // The navigation used to happen regardless of the response, so a refused deletion of an
      // entire budget looked like it had succeeded.
      toast.error(errorMessage(err, "Couldn't delete this budget."));
    }
  }

  return (
    <div>
      <SettingsRow label="Name" description="What this budget is called.">
        <div className="flex flex-col gap-2">
          <div className="flex gap-3 items-end">
            <Input
              className="flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
              }}
            />
            <Button disabled={!dirty || saving} onClick={() => void saveName()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {savedFlash && <p className="text-sm text-primary">Saved.</p>}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </SettingsRow>

      <SettingsRow label="Default budget" description="The default budget opens automatically when you sign in.">
        {budget.is_default ? (
          <p className="text-sm text-primary">Current default.</p>
        ) : (
          <Button variant="outline" size="sm" disabled={settingDefault} onClick={() => void setDefault()}>
            {settingDefault ? "Setting…" : "Set as default"}
          </Button>
        )}
      </SettingsRow>

      {budget.is_owner && (
        <SettingsRow
          label="Delete budget"
          description="Permanently removes the budget, all its transactions, and member access. This cannot be undone."
        >
          <ConfirmButton onConfirm={() => deleteBudget()} label="Delete budget" />
        </SettingsRow>
      )}
    </div>
  );
}
