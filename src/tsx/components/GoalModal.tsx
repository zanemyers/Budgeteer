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
import { getCsrfToken } from "@/lib/api";

export interface GoalCategory {
  id: number;
  name: string;
  category_type: "income" | "expense";
  parent_id: number | null;
  monthly_budget: string;
  is_goal: boolean;
  goal_target: string | null;
  goal_due_date: string | null;
  goal_ongoing: boolean;
  goal_monthly: string | null;
  total_saved?: string;
}

interface Props {
  budgetPk: number;
  goal?: GoalCategory | null;
  onClose: () => void;
  onSaved: (category: GoalCategory) => void;
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

export default function GoalModal({ budgetPk, goal, onClose, onSaved }: Props) {
  const isEdit = !!goal;
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal?.goal_target ?? "");
  const [dueDate, setDueDate] = useState(goal?.goal_due_date ?? "");
  const [ongoing, setOngoing] = useState(goal?.goal_ongoing ?? false);
  const [monthlyGoal, setMonthlyGoal] = useState(goal?.goal_monthly ?? "");
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
      goal_target: target,
      goal_due_date: ongoing ? null : dueDate,
      goal_ongoing: ongoing,
      goal_monthly: ongoing ? monthlyGoal : null,
    };
    if (isEdit) {
      body.add_amount = addAmount || "0";
      body.add_description = addDescription;
    } else {
      body.category_type = "expense";
      body.is_goal = true;
      body.goal_initial_balance = initialBalance || "0";
    }

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${goal!.id}/edit/`
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
      const cat = await res.json() as GoalCategory;
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
              <Label htmlFor="goal-name">Name</Label>
              <Input
                id="goal-name"
                placeholder="e.g. Vacation, New Car"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="col-span-12 md:col-span-5 flex flex-col gap-2">
              <Label htmlFor="goal-target">Target amount</Label>
              <CurrencyInput
                id="goal-target"
                min="0.01"
                placeholder="5000"
                value={target}
                onChange={setTarget}
                required
              />
            </div>

            <div className="col-span-12 flex items-center gap-2">
              <Switch id="goal-ongoing" checked={ongoing} onCheckedChange={setOngoing} />
              <Label htmlFor="goal-ongoing" className="font-normal">
                Ongoing fund (monthly goal instead of due date)
              </Label>
            </div>

            {ongoing ? (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="goal-monthly">Monthly goal</Label>
                <CurrencyInput
                  id="goal-monthly"
                  placeholder="100"
                  value={monthlyGoal}
                  onChange={setMonthlyGoal}
                  required={ongoing}
                />
              </div>
            ) : (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="goal-due">Due date</Label>
                <Input
                  id="goal-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required={!ongoing}
                />
              </div>
            )}

            {!isEdit && (
              <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                <Label htmlFor="goal-initial">
                  Already saved <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <CurrencyInput
                  id="goal-initial"
                  placeholder="0"
                  value={initialBalance}
                  onChange={setInitialBalance}
                />
              </div>
            )}

            {isEdit && (
              <>
                <div className="col-span-12 md:col-span-5 flex flex-col gap-2">
                  <Label htmlFor="goal-add">
                    Add to balance <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <CurrencyInput
                    id="goal-add"
                    min="0.01"
                    placeholder="0.00"
                    value={addAmount}
                    onChange={setAddAmount}
                  />
                </div>
                {addAmount && parseFloat(addAmount) > 0 && (
                  <div className="col-span-12 md:col-span-7 flex flex-col gap-2">
                    <Label htmlFor="goal-add-desc">Description</Label>
                    <Input
                      id="goal-add-desc"
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
