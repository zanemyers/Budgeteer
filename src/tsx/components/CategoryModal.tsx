import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, jsonFetch } from "@/lib/api";
import { useCurrencySymbol } from "@/utils/currency";

interface CategoryShape {
  id: number;
  name: string;
  category_type: "income" | "expense";
  parent_id: number | null;
  monthly_budget: string;
  rollover: boolean;
  base_amount: string;
  rollover_start: string | null;
  is_goal: boolean;
  goal_target: string | null;
  goal_due_date: string | null;
  goal_ongoing: boolean;
  goal_monthly: string | null;
}

interface Props {
  budgetPk: number;
  type: "income" | "expense";
  categories: CategoryShape[];
  category?: CategoryShape | null;
  defaultParentId?: number | null;
  onClose: () => void;
  onSaved: (category: CategoryShape) => void;
  onChildSaved?: (child: CategoryShape) => void;
  onChildDeleted?: (childId: number) => void;
}

export default function CategoryModal({
  budgetPk,
  type,
  categories,
  category,
  defaultParentId,
  onClose,
  onSaved,
  onChildSaved,
  onChildDeleted,
}: Props) {
  const isEdit = !!category;
  const initialParent = category?.parent_id ?? defaultParentId ?? null;
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(initialParent ? String(initialParent) : "none");
  const [rollover, setRollover] = useState(category?.rollover ?? false);
  const [baseAmount, setBaseAmount] = useState(category?.base_amount ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Inline child management — only meaningful when editing a top-level category.
  const isTopLevel = isEdit && category!.parent_id === null && !category!.is_goal;
  const children = isTopLevel ? categories.filter((c) => c.parent_id === category!.id) : [];
  // If this category already has children, it can't itself become a child of another
  // (the model only supports a single level of nesting).
  const hasChildren = isEdit && children.length > 0;
  const [newChildName, setNewChildName] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [childError, setChildError] = useState("");
  // Was a hard-coded "$" on the rollover base amount field.
  const symbol = useCurrencySymbol();

  const eligibleParents = categories.filter(
    (c) => c.category_type === type && !c.is_goal && c.parent_id === null && (!isEdit || c.id !== category!.id),
  );

  const typeLabel = type === "income" ? "Income" : "Expense";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = {
      name,
      parent_id: parentId === "none" ? null : parentId,
    };
    if (!isEdit) body.category_type = type;
    if (type === "expense") {
      body.rollover = rollover;
      body.base_amount = rollover ? baseAmount || "0" : "0";
    }

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${category!.id}/edit/`
      : `/budgets/${budgetPk}/categories/create/`;
    const method = isEdit ? "PATCH" : "POST";

    try {
      const cat = (await jsonFetch(url, method, body)) as CategoryShape;
      onSaved(cat);
    } catch (err) {
      // Was a bare catch reporting "Network error." for every failure, including
      // validation rejections, and the error branch above called res.json() unguarded
      // so an HTML error page threw straight past it.
      setError(errorMessage(err, "Could not save."));
      setSaving(false);
    }
  }

  async function addChild(e: React.FormEvent) {
    e.preventDefault();
    if (!newChildName.trim() || !category) return;
    setAddingChild(true);
    setChildError("");
    try {
      const child = (await jsonFetch(`/budgets/${budgetPk}/categories/create/`, "POST", {
        name: newChildName.trim(),
        category_type: type,
        parent_id: category.id,
      })) as CategoryShape;
      onChildSaved?.(child);
      setNewChildName("");
    } catch (err) {
      setChildError(errorMessage(err, "Could not add."));
    } finally {
      setAddingChild(false);
    }
  }

  async function deleteChild(child: CategoryShape) {
    try {
      await jsonFetch(`/budgets/${budgetPk}/categories/${child.id}/delete/`, "DELETE");
      onChildDeleted?.(child.id);
    } catch (err) {
      setChildError(errorMessage(err, `Could not delete ${child.name}.`));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit" : "Add"} {typeLabel} Category
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                placeholder="e.g. Groceries"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {!hasChildren && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cat-parent">
                  Parent category <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger id="cat-parent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Top-level {typeLabel.toLowerCase()} category —</SelectItem>
                    {eligibleParents.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <small className="text-muted-foreground">
                  Leave blank to create a top-level category, or choose a parent to make this a subcategory.
                </small>
              </div>
            )}

            {type === "expense" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="cat-rollover"
                    checked={rollover}
                    onCheckedChange={(v) => setRollover(v === true)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="cat-rollover">Roll over leftover balance</Label>
                    <small className="text-muted-foreground">
                      Budget a set amount each month; unspent money carries into the next month instead of resetting —
                      good for saving toward something bigger.
                    </small>
                  </div>
                </div>
                {rollover && (
                  <div className="flex flex-col gap-2 pl-7">
                    <Label htmlFor="cat-base">Base amount / month</Label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                        {symbol}
                      </span>
                      <Input
                        id="cat-base"
                        type="number"
                        step="0.01"
                        min="0"
                        className="rounded-l-none"
                        placeholder="e.g. 100"
                        value={baseAmount}
                        onChange={(e) => setBaseAmount(e.target.value)}
                      />
                    </div>
                    <small className="text-muted-foreground">
                      Budgeted automatically each month
                      {isEdit && category?.rollover_start ? "" : ", starting this month"}. Replaces manual assigning for
                      this category.
                    </small>
                  </div>
                )}
              </div>
            )}

            {isTopLevel && (
              <div className="flex flex-col gap-2 pt-2 border-t">
                <Label className="mt-2">Subcategories</Label>
                {children.length === 0 ? (
                  <p className="text-muted-foreground text-sm">None yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {children.map((c) => (
                      <div key={c.id} className="flex justify-between items-center px-3 py-1.5 rounded-md bg-muted/50">
                        <span className="text-sm">{c.name}</span>
                        <ConfirmButton size="xs" onConfirm={() => deleteChild(c)} label="Remove" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <Input
                    placeholder="Add a subcategory…"
                    aria-label="New subcategory name"
                    value={newChildName}
                    onChange={(e) => setNewChildName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addChild(e);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newChildName.trim() || addingChild}
                    onClick={(e) => void addChild(e)}
                  >
                    {addingChild ? "Adding…" : "Add"}
                  </Button>
                </div>
                {childError && <p className="text-destructive text-sm">{childError}</p>}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
