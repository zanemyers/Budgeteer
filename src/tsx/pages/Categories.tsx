import { useState } from "react";
import CategoryModal from "../components/CategoryModal";
import SinkingFundModal, { type SinkingFundCategory } from "../components/SinkingFundModal";

interface CategoryType extends SinkingFundCategory {
  parent_id: number | null;
}

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  categories: CategoryType[];
  type_choices: TypeChoice[];
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

export default function Categories({ budget_pk, categories: initialCategories }: Props) {
  const [categories, setCategories] = useState(initialCategories);
  const [addingType, setAddingType] = useState<"income" | "expense" | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryType | null>(null);
  const [addingSinkingFund, setAddingSinkingFund] = useState(false);
  const [editingSF, setEditingSF] = useState<CategoryType | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  const income = categories.filter((c) => c.category_type === "income" && !c.is_sinking_fund);
  const expense = categories.filter((c) => c.category_type === "expense" && !c.is_sinking_fund);
  const sinkingFunds = categories.filter((c) => c.is_sinking_fund);

  function upsert(cat: CategoryType) {
    setCategories((prev) => {
      const exists = prev.some((c) => c.id === cat.id);
      return exists ? prev.map((c) => (c.id === cat.id ? cat : c)) : [...prev, cat];
    });
  }

  async function handleDelete(cat: CategoryType) {
    if (deletingId !== cat.id) { setDeletingId(cat.id); return; }
    try {
      await apiFetch(`/budgets/${budget_pk}/categories/${cat.id}/delete/`, "DELETE");
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch {
      setDeleteError((prev) => ({ ...prev, [cat.id]: "Cannot delete — category has transactions." }));
    } finally {
      setDeletingId(null);
    }
  }

  function renderCategoryRow(cat: CategoryType, isChild: boolean) {
    return (
      <li key={cat.id} className="list-group-item flex justify-between items-center py-2" style={isChild ? { paddingLeft: "2.5rem" } : undefined}>
        <span>
          {isChild && <span className="text-muted mr-1">↳</span>}
          {cat.name}
        </span>
        <div className="flex items-center gap-2">
          {deleteError[cat.id] && <small className="text-danger">{deleteError[cat.id]}</small>}
          {deletingId === cat.id ? (
            <>
              <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Confirm</button>
              <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setDeletingId(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button
                className="btn btn-outline-secondary btn-sm py-0 px-2"
                style={{ fontSize: "0.75rem" }}
                onClick={() => setEditingCategory(cat)}
              >
                Edit
              </button>
              <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Delete</button>
            </>
          )}
        </div>
      </li>
    );
  }

  function renderSection(sectionCategories: CategoryType[], label: string, colorClass: string, wrapperClass = "col-span-12 md:col-span-6") {
    const roots = sectionCategories.filter((c) => c.parent_id === null);
    const childrenByParent = new Map<number, CategoryType[]>();
    for (const c of sectionCategories) {
      if (c.parent_id !== null) {
        const list = childrenByParent.get(c.parent_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_id, list);
      }
    }

    const card = (
      <div className="card">
        <div className={`card-header flex justify-between items-center bg-${colorClass} bg-opacity-10`}>
          <span className={`text-sm font-bold text-${colorClass}`}>{label}</span>
          <button
            className={`btn btn-outline-${colorClass} btn-sm py-0 px-2`}
            style={{ fontSize: "0.75rem" }}
            onClick={() => setAddingType(label.toLowerCase() as "income" | "expense")}
          >
            + Add
          </button>
        </div>
        {sectionCategories.length === 0 ? (
          <div className="card-body text-muted text-sm">No {label.toLowerCase()} categories yet.</div>
        ) : (
          <ul className="list-group list-group-flush">
            {roots.flatMap((root) => [
              renderCategoryRow(root, false),
              ...(childrenByParent.get(root.id) ?? []).map((child) => renderCategoryRow(child, true)),
            ])}
          </ul>
        )}
      </div>
    );
    return wrapperClass ? <div className={wrapperClass}>{card}</div> : <>{card}</>;
  }

  const modalType = editingCategory?.category_type ?? addingType;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="mb-0">Categories</h1>
        <a href={`/budgets/${budget_pk}/`} className="btn btn-outline-secondary btn-sm">← Back to Budget</a>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {renderSection(expense, "Expense", "danger")}
        <div className="col-span-12 md:col-span-6 flex flex-col gap-6">
          {renderSection(income, "Income", "success", "")}

          <div className="card">
            <div className="card-header flex justify-between items-center bg-warning bg-opacity-10">
              <span className="text-sm font-bold text-warning-emphasis">Sinking Funds</span>
              <button
                className="btn btn-outline-warning btn-sm py-0 px-2"
                style={{ fontSize: "0.75rem" }}
                onClick={() => setAddingSinkingFund(true)}
              >
                + Add
              </button>
            </div>

            {sinkingFunds.length === 0 ? (
              <div className="card-body text-muted text-sm">No sinking funds yet. Add one to save toward a goal.</div>
            ) : (
              <ul className="list-group list-group-flush">
                {sinkingFunds.map((cat) => {
                  const saved = parseFloat(cat.total_saved ?? "0");
                  const target = parseFloat(cat.sinking_fund_target ?? "0");
                  const pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
                  return (
                    <li key={cat.id} className="list-group-item py-2 px-4">
                      <div className="flex justify-between items-start">
                        <div className="grow mr-4">
                          <div className="font-medium">
                            {cat.name}
                            {cat.sinking_fund_ongoing && <span className="badge bg-secondary ml-2" style={{ fontSize: "0.65rem" }}>ongoing</span>}
                          </div>
                          <div className="text-muted text-sm">
                            ${saved.toFixed(2)} saved of ${target.toFixed(2)}
                            {cat.sinking_fund_ongoing && cat.sinking_fund_monthly_goal && parseFloat(cat.sinking_fund_monthly_goal) > 0
                              ? <> · ${parseFloat(cat.sinking_fund_monthly_goal).toFixed(2)}/mo goal</>
                              : cat.sinking_fund_due_date
                                ? <> · Due {new Date(cat.sinking_fund_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</>
                                : null
                            }
                          </div>
                          <div className="progress mt-1" style={{ height: 4, maxWidth: 200 }}>
                            <div className={`progress-bar ${pct >= 100 ? "bg-success" : "bg-warning"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {deleteError[cat.id] && <small className="text-danger">{deleteError[cat.id]}</small>}
                          {deletingId === cat.id ? (
                            <>
                              <button className="btn btn-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Confirm</button>
                              <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setDeletingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setEditingSF(cat)}>Edit</button>
                              <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => void handleDelete(cat)}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {modalType && (addingType || editingCategory) && (
        <CategoryModal
          budgetPk={budget_pk}
          type={modalType}
          categories={categories}
          category={editingCategory}
          onClose={() => { setAddingType(null); setEditingCategory(null); }}
          onSaved={(cat) => {
            upsert(cat as CategoryType);
            setAddingType(null);
            setEditingCategory(null);
          }}
        />
      )}

      {(addingSinkingFund || editingSF) && (
        <SinkingFundModal
          budgetPk={budget_pk}
          fund={editingSF}
          onClose={() => { setAddingSinkingFund(false); setEditingSF(null); }}
          onSaved={(cat) => { upsert(cat as CategoryType); setAddingSinkingFund(false); setEditingSF(null); }}
        />
      )}
    </div>
  );
}
