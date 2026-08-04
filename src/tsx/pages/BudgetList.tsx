import { router } from "@inertiajs/react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, jsonFetch } from "@/lib/api";
import { fmtDate } from "@/utils/date";

interface Budget {
  id: number;
  name: string;
  created_at: string;
  is_owner: boolean;
  is_default: boolean;
}

interface Props {
  budgets: Budget[];
}

function displayName(budget: Budget): string {
  return budget.name || `Budget #${budget.id}`;
}

export default function BudgetList({ budgets: initial }: Props) {
  const [budgets, setBudgets] = useState(initial);
  const [editingName, setEditingName] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [copyCategories, setCopyCategories] = useState(true);
  const [copyPaymentMethods, setCopyPaymentMethods] = useState(true);
  const [copyMembers, setCopyMembers] = useState(true);
  const [addDefaults, setAddDefaults] = useState(true);
  const [creating, setCreating] = useState(false);

  function resetForm() {
    setNewName(null);
    setCopyFrom("");
    setCopyCategories(true);
    setCopyPaymentMethods(true);
    setCopyMembers(true);
    setAddDefaults(true);
  }

  async function createBudget() {
    if (newName === null) return;
    setCreating(true);
    try {
      const body: {
        name: string;
        copy_from?: number;
        copy_categories?: boolean;
        copy_payment_methods?: boolean;
        copy_members?: boolean;
        add_default_categories?: boolean;
      } = { name: newName.trim() };
      if (copyFrom) {
        body.copy_from = parseInt(copyFrom, 10);
        body.copy_categories = copyCategories;
        body.copy_payment_methods = copyPaymentMethods;
        body.copy_members = copyMembers;
      } else {
        body.add_default_categories = addDefaults;
      }
      const { id } = (await jsonFetch("/budgets/create/", "POST", body)) as { id: number };
      router.visit(`/budgets/${id}/`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create that budget."));
    } finally {
      setCreating(false);
    }
  }

  async function saveName(budget: Budget) {
    const val = editingName[budget.id];
    const clearBuffer = () =>
      setEditingName((prev) => {
        const n = { ...prev };
        delete n[budget.id];
        return n;
      });
    if (val === undefined || val === budget.name) {
      clearBuffer();
      return;
    }
    setSavingId(budget.id);
    try {
      const updated = (await jsonFetch(`/budgets/${budget.id}/edit/`, "PATCH", { name: val })) as {
        id: number;
        name: string;
      };
      setBudgets((prev) => prev.map((b) => (b.id === updated.id ? { ...b, name: updated.name } : b)));
      // Only drop the edit buffer once saved, so a failure leaves the typed name in place
      // to correct rather than silently reverting to the old one.
      clearBuffer();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't rename that budget."));
    } finally {
      setSavingId(null);
    }
  }

  async function setDefault(id: number) {
    setSettingDefaultId(id);
    try {
      await jsonFetch(`/budgets/${id}/set-default/`, "POST");
      setBudgets((prev) => prev.map((b) => ({ ...b, is_default: b.id === id })));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't set that budget as default."));
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function deleteBudget(id: number) {
    // The local removal has to be gated on the response: doing it unconditionally made a
    // failed delete look like it worked, and the budget reappeared on the next page load.
    try {
      await jsonFetch(`/budgets/${id}/delete/`, "DELETE");
      setBudgets((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete that budget."));
    }
  }

  return (
    <div className="max-w-2xl">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">My Budgets</h1>
        {newName === null && <Button onClick={() => setNewName("")}>New Budget</Button>}
      </header>

      {newName !== null && (
        <Card className="mb-6 border-rule shadow-none">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="budget-name" className="font-semibold">
                Budget name
              </Label>
              <Input
                id="budget-name"
                placeholder="e.g. Vacation 2025"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  // The `creating` guard is on the submit button but was missing here, so two
                  // quick Enter presses created two budgets.
                  if (e.key === "Enter" && !creating) void createBudget();
                  if (e.key === "Escape") resetForm();
                }}
              />
            </div>
            {budgets.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">
                  Copy from existing budget <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select value={copyFrom || "none"} onValueChange={(v) => setCopyFrom(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Start fresh —</SelectItem>
                    {budgets.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {displayName(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {copyFrom && (
                  <div className="flex flex-col gap-2 mt-2">
                    {(
                      [
                        {
                          key: "categories",
                          label: "Category names (no amounts)",
                          value: copyCategories,
                          set: setCopyCategories,
                        },
                        {
                          key: "payment_methods",
                          label: "Payment methods",
                          value: copyPaymentMethods,
                          set: setCopyPaymentMethods,
                        },
                        { key: "members", label: "Members", value: copyMembers, set: setCopyMembers },
                      ] as const
                    ).map(({ key, label, value, set }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox id={`copy-${key}`} checked={value} onCheckedChange={(c) => set(c === true)} />
                        <Label htmlFor={`copy-${key}`} className="text-sm font-normal">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!copyFrom && (
              <div className="flex items-start gap-2">
                <Checkbox id="add-defaults" checked={addDefaults} onCheckedChange={(c) => setAddDefaults(c === true)} />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="add-defaults" className="text-sm font-normal">
                    Start with suggested categories
                  </Label>
                  <span className="text-muted-foreground text-xs">
                    Adds common income/expense categories (Salary, Housing, Food, etc.) you can rename or remove later.
                  </span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button disabled={creating} onClick={() => void createBudget()}>
                {creating ? "Creating…" : "Create"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {budgets.length === 0 && newName === null ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="mb-4">You don&apos;t have any budgets yet.</p>
          <Button onClick={() => setNewName("")}>Create your first budget</Button>
        </div>
      ) : budgets.length > 0 ? (
        <div className="flex flex-col gap-2">
          {budgets.map((budget) => {
            const isEditing = budget.id in editingName;
            const isSaving = savingId === budget.id;
            const isSettingDefault = settingDefaultId === budget.id;

            return (
              <div
                key={budget.id}
                className="flex items-center gap-4 p-4 rounded-lg border border-rule bg-surface group"
              >
                <div className="grow min-w-0">
                  {isEditing ? (
                    <Input
                      value={editingName[budget.id]}
                      autoFocus
                      onChange={(e) => setEditingName((prev) => ({ ...prev, [budget.id]: e.target.value }))}
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
                      <div className="flex items-center gap-2">
                        <a
                          href={`/budgets/${budget.id}/`}
                          className="font-semibold no-underline text-foreground hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            router.visit(`/budgets/${budget.id}/`);
                          }}
                        >
                          {displayName(budget)}
                        </a>
                        {budget.is_default && <Badge variant="success">Default</Badge>}
                      </div>
                      <span className="text-muted-foreground text-sm">Created {fmtDate(budget.created_at)}</span>
                    </>
                  )}
                </div>

                {budget.is_owner && (
                  <div className="flex items-center gap-2 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {!budget.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isSettingDefault}
                        onClick={() => void setDefault(budget.id)}
                      >
                        {isSettingDefault ? "…" : "Set Default"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSaving || isEditing}
                      onClick={() => setEditingName((prev) => ({ ...prev, [budget.id]: budget.name }))}
                    >
                      {isSaving ? "…" : "Rename"}
                    </Button>
                    <ConfirmButton size="sm" onConfirm={() => deleteBudget(budget.id)} label="Delete" />
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
