import { useState } from "react";
import { Pencil } from "lucide-react";
import CategoryModal from "@/components/CategoryModal";
import type { SinkingFundCategory } from "@/components/SinkingFundModal";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface CategoryType extends SinkingFundCategory {
  parent_id: number | null;
}

interface Props {
  budgetPk: number;
  type: "income" | "expense";
  categories: CategoryType[];
  onCategoriesChange: (next: CategoryType[]) => void;
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

export function CategoriesPanel({ budgetPk, type, categories, onCategoriesChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CategoryType | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  const visible = categories.filter((c) => c.category_type === type && !c.is_sinking_fund);
  const title = type === "income" ? "Income categories" : "Expense categories";

  function upsert(cat: CategoryType) {
    const exists = categories.some((c) => c.id === cat.id);
    onCategoriesChange(
      exists ? categories.map((c) => (c.id === cat.id ? cat : c)) : [...categories, cat],
    );
  }

  async function handleDelete(cat: CategoryType) {
    try {
      await apiFetch(`/budgets/${budgetPk}/categories/${cat.id}/delete/`, "DELETE");
      onCategoriesChange(categories.filter((c) => c.id !== cat.id));
    } catch {
      setDeleteError((prev) => ({ ...prev, [cat.id]: "Cannot delete — category has transactions." }));
    }
  }

  const roots = visible.filter((c) => c.parent_id === null);
  const childrenByParent = new Map<number, CategoryType[]>();
  for (const c of visible) {
    if (c.parent_id !== null) {
      const list = childrenByParent.get(c.parent_id) ?? [];
      list.push(c);
      childrenByParent.set(c.parent_id, list);
    }
  }

  function CategoryRow({ cat, isChild }: { cat: CategoryType; isChild: boolean }) {
    return (
      <div
        className="flex justify-between items-center py-2 px-4 border-t first:border-t-0"
        style={isChild ? { paddingLeft: "2.5rem" } : undefined}
      >
        <span>
          {isChild && <span className="text-muted-foreground mr-1">↳</span>}
          {cat.name}
        </span>
        <div className="flex items-center gap-2">
          {deleteError[cat.id] && <small className="text-destructive">{deleteError[cat.id]}</small>}
          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(cat)} aria-label="Edit category"><Pencil /></Button>
          <ConfirmButton size="xs" onConfirm={() => handleDelete(cat)} label="Delete" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button size="sm" onClick={() => setAdding(true)}>+ Add</Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="text-center py-10">
            <p className="text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>
            <button
              type="button"
              className="text-sm text-primary hover:underline mt-1 cursor-pointer"
              onClick={() => setAdding(true)}
            >
              + Add your first
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 gap-0">
          {roots.flatMap((root) => [
            <CategoryRow key={root.id} cat={root} isChild={false} />,
            ...(childrenByParent.get(root.id) ?? []).map((child) => (
              <CategoryRow key={child.id} cat={child} isChild={true} />
            )),
          ])}
        </Card>
      )}

      {(adding || editing) && (
        <CategoryModal
          budgetPk={budgetPk}
          type={type}
          categories={categories}
          category={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(cat) => {
            upsert(cat as CategoryType);
            setAdding(false);
            setEditing(null);
          }}
          onChildSaved={(child) => upsert(child as CategoryType)}
          onChildDeleted={(id) => onCategoriesChange(categories.filter((c) => c.id !== id))}
        />
      )}
    </div>
  );
}
