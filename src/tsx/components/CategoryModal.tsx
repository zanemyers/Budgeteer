import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCsrfToken } from "@/lib/api";

interface CategoryShape {
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Inline child management — only meaningful when editing a top-level category.
  const isTopLevel = isEdit && category!.parent_id === null && !category!.is_goal;
  const children = isTopLevel
    ? categories.filter((c) => c.parent_id === category!.id)
    : [];
  // If this category already has children, it can't itself become a child of another
  // (the model only supports a single level of nesting).
  const hasChildren = isEdit && children.length > 0;
  const [newChildName, setNewChildName] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [childError, setChildError] = useState("");

  const eligibleParents = categories.filter((c) =>
    c.category_type === type
    && !c.is_goal
    && c.parent_id === null
    && (!isEdit || c.id !== category!.id)
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

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${category!.id}/edit/`
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
      const cat = await res.json() as CategoryShape;
      onSaved(cat);
    } catch {
      setError("Network error.");
      setSaving(false);
    }
  }

  async function addChild(e: React.FormEvent) {
    e.preventDefault();
    if (!newChildName.trim() || !category) return;
    setAddingChild(true);
    setChildError("");
    try {
      const res = await fetch(`/budgets/${budgetPk}/categories/create/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({
          name: newChildName.trim(),
          category_type: type,
          parent_id: category.id,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { errors?: Record<string, string[]> };
        setChildError(Object.values(data.errors ?? data).flat().join(" ") || "Could not add.");
        return;
      }
      const child = await res.json() as CategoryShape;
      onChildSaved?.(child);
      setNewChildName("");
    } finally {
      setAddingChild(false);
    }
  }

  async function deleteChild(child: CategoryShape) {
    const res = await fetch(`/budgets/${budgetPk}/categories/${child.id}/delete/`, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    if (res.ok || res.status === 204) {
      onChildDeleted?.(child.id);
    } else {
      setChildError(`Could not delete ${child.name}.`);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit" : "Add"} {typeLabel} Category</DialogTitle>
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
                  <SelectTrigger id="cat-parent" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Top-level {typeLabel.toLowerCase()} category —</SelectItem>
                    {eligibleParents.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <small className="text-muted-foreground">
                  Leave blank to create a top-level category, or choose a parent to make this a subcategory.
                </small>
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
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
