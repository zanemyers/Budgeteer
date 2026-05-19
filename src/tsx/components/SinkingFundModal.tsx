import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface SinkingFundCategory {
  id: number;
  name: string;
  category_type: "income" | "expense";
  parent_id: number | null;
  monthly_budget: string;
  is_sinking_fund: boolean;
  sinking_fund_target: string | null;
  sinking_fund_due_date: string | null;
  sinking_fund_ongoing: boolean;
  sinking_fund_monthly_goal: string | null;
  total_saved?: string;
}

interface Props {
  budgetPk: number;
  fund?: SinkingFundCategory | null;
  onClose: () => void;
  onSaved: (category: SinkingFundCategory) => void;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

function CurrencyInput({
  id, value, onChange, placeholder, required, min = "0", step = "0.01",
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <div className="flex">
      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">$</span>
      <Input
        id={id}
        type="number"
        className="rounded-l-none"
        min={min}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </div>
  );
}

export default function SinkingFundModal({ budgetPk, fund, onClose, onSaved }: Props) {
  const isEdit = !!fund;
  const [name, setName] = useState(fund?.name ?? "");
  const [target, setTarget] = useState(fund?.sinking_fund_target ?? "");
  const [dueDate, setDueDate] = useState(fund?.sinking_fund_due_date ?? "");
  const [ongoing, setOngoing] = useState(fund?.sinking_fund_ongoing ?? false);
  const [monthlyGoal, setMonthlyGoal] = useState(fund?.sinking_fund_monthly_goal ?? "");
  const [initialBalance, setInitialBalance] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = {
      name,
      sinking_fund_target: target,
      sinking_fund_due_date: ongoing ? null : dueDate,
      sinking_fund_ongoing: ongoing,
      sinking_fund_monthly_goal: ongoing ? monthlyGoal : null,
    };
    if (isEdit) {
      body.add_amount = addAmount || "0";
      body.add_description = addDescription;
    } else {
      body.category_type = "expense";
      body.is_sinking_fund = true;
      body.sinking_fund_initial_balance = initialBalance || "0";
    }

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${fund!.id}/edit/`
      : `/budgets/${budgetPk}/categories/create/`;
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { errors?: Record<string, string[]> };
        const flat = Object.values(data.errors ?? data).flat().join(" ");
        setError(flat || "Could not save.");
        setSaving(false);
        return;
      }
      const cat = await res.json() as SinkingFundCategory;
      onSaved(cat);
    } catch {
      setError("Network error.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Goal" : "Add Goal"}</DialogTitle>
          </DialogHeader>

          <div className="py-4 grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-7 flex flex-col gap-2">
              <Label htmlFor="sf-name">Name</Label>
              <Input
                id="sf-name"
                placeholder="e.g. Vacation, New Car"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="col-span-12 md:col-span-5 flex flex-col gap-2">
              <Label htmlFor="sf-target">Target amount</Label>
              <CurrencyInput
                id="sf-target"
                min="0.01"
                placeholder="5000"
                value={target}
                onChange={setTarget}
                required
              />
            </div>

            <div className="col-span-12 flex items-center gap-2">
              <Switch id="sf-ongoing" checked={ongoing} onCheckedChange={setOngoing} />
              <Label htmlFor="sf-ongoing" className="font-normal">
                Ongoing fund (monthly goal instead of due date)
              </Label>
            </div>

            {ongoing ? (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="sf-monthly">Monthly goal</Label>
                <CurrencyInput
                  id="sf-monthly"
                  placeholder="100"
                  value={monthlyGoal}
                  onChange={setMonthlyGoal}
                  required={ongoing}
                />
              </div>
            ) : (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="sf-due">Due date</Label>
                <Input
                  id="sf-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required={!ongoing}
                />
              </div>
            )}

            {!isEdit && (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="sf-initial">
                  Already saved <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <CurrencyInput
                  id="sf-initial"
                  placeholder="0"
                  value={initialBalance}
                  onChange={setInitialBalance}
                />
              </div>
            )}

            {isEdit && (
              <>
                <div className="col-span-12 md:col-span-5 flex flex-col gap-2">
                  <Label htmlFor="sf-add">
                    Add to balance <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <CurrencyInput
                    id="sf-add"
                    min="0.01"
                    placeholder="0.00"
                    value={addAmount}
                    onChange={setAddAmount}
                  />
                </div>
                {addAmount && parseFloat(addAmount) > 0 && (
                  <div className="col-span-12 md:col-span-7 flex flex-col gap-2">
                    <Label htmlFor="sf-add-desc">Description</Label>
                    <Input
                      id="sf-add-desc"
                      placeholder="e.g. Initial deposit"
                      value={addDescription}
                      onChange={(e) => setAddDescription(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="col-span-12">
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim() || !target}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
