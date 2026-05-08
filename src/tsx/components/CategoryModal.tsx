import { Component, createRef } from "react";

interface CategoryShape {
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
}

interface Props {
  budgetPk: number;
  type: "income" | "expense";
  categories: CategoryShape[];           // all categories — used to populate parent dropdown
  category?: CategoryShape | null;       // when set, modal is in edit mode
  onClose: () => void;
  onSaved: (category: CategoryShape) => void;
}

interface State {
  name: string;
  parent_id: string;     // "" means root
  saving: boolean;
  error: string;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default class CategoryModal extends Component<Props, State> {
  private nameRef = createRef<HTMLInputElement>();

  constructor(props: Props) {
    super(props);
    this.state = {
      name: props.category?.name ?? "",
      parent_id: props.category?.parent_id ? String(props.category.parent_id) : "",
      saving: false,
      error: "",
    };
  }

  componentDidMount() {
    document.addEventListener("keydown", this.handleEscape);
    setTimeout(() => this.nameRef.current?.focus(), 0);
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this.handleEscape);
  }

  handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !this.state.saving) this.props.onClose();
  };

  handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { budgetPk, type, category, onSaved } = this.props;
    const { name, parent_id } = this.state;
    const isEdit = !!category;
    this.setState({ saving: true, error: "" });

    const body: Record<string, unknown> = {
      name,
      parent_id: parent_id || null,
    };
    if (!isEdit) body.category_type = type;

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${category.id}/edit/`
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
        this.setState({ error: flat || "Could not save.", saving: false });
        return;
      }
      const cat = await res.json() as CategoryShape;
      onSaved(cat);
    } catch {
      this.setState({ error: "Network error.", saving: false });
    }
  };

  render() {
    const { type, categories, category, onClose } = this.props;
    const { name, parent_id, saving, error } = this.state;
    const isEdit = !!category;

    // Eligible parents: same type, not a sinking fund, not the category being edited,
    // not currently a child itself (no grandchildren), and the category being edited
    // can't become its own ancestor.
    const eligibleParents = categories.filter((c) =>
      c.category_type === type
      && !c.is_sinking_fund
      && c.parent_id === null
      && (!isEdit || c.id !== category.id)
    );

    const typeLabel = type === "income" ? "Income" : "Expense";

    return (
      <div
        className="modal fade show block"
        style={{ background: "rgba(0,0,0,0.5)" }}
        tabIndex={-1}
        onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      >
        <div className="modal-dialog" role="document">
          <div className="modal-content">
            <form onSubmit={this.handleSubmit}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {isEdit ? "Edit" : "Add"} {typeLabel} Category
                </h5>
                <button type="button" className="btn-close" onClick={onClose} aria-label="Close" disabled={saving} />
              </div>

              <div className="modal-body">
                <div className="mb-4">
                  <label className="form-label">Name</label>
                  <input
                    ref={this.nameRef}
                    className="form-control"
                    placeholder="e.g. Groceries"
                    value={name}
                    onChange={(e) => this.setState({ name: e.target.value })}
                    required
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label">Parent category <span className="text-muted font-normal">(optional)</span></label>
                  <select
                    className="form-select"
                    value={parent_id}
                    onChange={(e) => this.setState({ parent_id: e.target.value })}
                  >
                    <option value="">— Top-level {typeLabel.toLowerCase()} category —</option>
                    {eligibleParents.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <small className="text-muted">
                    Leave blank to create a top-level category, or choose a parent to make this a subcategory.
                  </small>
                </div>

                {error && <div className="alert alert-danger py-2 mb-0 mt-3">{error}</div>}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }
}
