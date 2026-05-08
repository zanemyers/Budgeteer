import { Component, createRef } from "react";

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

interface State {
  name: string;
  target: string;
  due_date: string;
  ongoing: boolean;
  monthly_goal: string;
  initial_balance: string;
  add_amount: string;
  add_description: string;
  saving: boolean;
  error: string;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default class SinkingFundModal extends Component<Props, State> {
  private nameRef = createRef<HTMLInputElement>();

  constructor(props: Props) {
    super(props);
    const fund = props.fund;
    this.state = {
      name: fund?.name ?? "",
      target: fund?.sinking_fund_target ?? "",
      due_date: fund?.sinking_fund_due_date ?? "",
      ongoing: fund?.sinking_fund_ongoing ?? false,
      monthly_goal: fund?.sinking_fund_monthly_goal ?? "",
      initial_balance: "",
      add_amount: "",
      add_description: "",
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
    const { budgetPk, fund, onSaved } = this.props;
    const { name, target, due_date, ongoing, monthly_goal, initial_balance, add_amount, add_description } = this.state;
    const isEdit = !!fund;
    this.setState({ saving: true, error: "" });

    const body: Record<string, unknown> = {
      name,
      sinking_fund_target: target,
      sinking_fund_due_date: ongoing ? null : due_date,
      sinking_fund_ongoing: ongoing,
      sinking_fund_monthly_goal: ongoing ? monthly_goal : null,
    };
    if (isEdit) {
      body.add_amount = add_amount || "0";
      body.add_description = add_description;
    } else {
      body.category_type = "expense";
      body.is_sinking_fund = true;
      body.sinking_fund_initial_balance = initial_balance || "0";
    }

    const url = isEdit
      ? `/budgets/${budgetPk}/categories/${fund.id}/edit/`
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
      const cat = await res.json() as SinkingFundCategory;
      onSaved(cat);
    } catch {
      this.setState({ error: "Network error.", saving: false });
    }
  };

  render() {
    const { fund, onClose } = this.props;
    const { name, target, due_date, ongoing, monthly_goal, initial_balance, add_amount, add_description, saving, error } = this.state;
    const isEdit = !!fund;

    return (
      <div
        className="modal fade show block"
        style={{ background: "rgba(0,0,0,0.5)" }}
        tabIndex={-1}
        onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      >
        <div className="modal-dialog modal-lg" role="document">
          <div className="modal-content">
            <form onSubmit={this.handleSubmit}>
              <div className="modal-header">
                <h5 className="modal-title">{isEdit ? "Edit Sinking Fund" : "Add Sinking Fund"}</h5>
                <button type="button" className="btn-close" onClick={onClose} aria-label="Close" disabled={saving} />
              </div>

              <div className="modal-body">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 md:col-span-7">
                    <label className="form-label">Name</label>
                    <input
                      ref={this.nameRef}
                      className="form-control"
                      placeholder="e.g. Vacation, New Car"
                      value={name}
                      onChange={(e) => this.setState({ name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="col-span-12 md:col-span-5">
                    <label className="form-label">Target amount</label>
                    <div className="input-group">
                      <span className="input-group-text">$</span>
                      <input
                        type="number" className="form-control" min="0.01" step="0.01"
                        placeholder="5000"
                        value={target}
                        onChange={(e) => this.setState({ target: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="col-span-12">
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input" type="checkbox" role="switch"
                        id="sf-modal-ongoing"
                        checked={ongoing}
                        onChange={(e) => this.setState({ ongoing: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="sf-modal-ongoing">
                        Ongoing fund (monthly goal instead of due date)
                      </label>
                    </div>
                  </div>

                  {ongoing ? (
                    <div className="col-span-12 md:col-span-6">
                      <label className="form-label">Monthly goal</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" className="form-control" min="0" step="0.01"
                          placeholder="100"
                          value={monthly_goal}
                          onChange={(e) => this.setState({ monthly_goal: e.target.value })}
                          required={ongoing}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="col-span-12 md:col-span-6">
                      <label className="form-label">Due date</label>
                      <input
                        type="date" className="form-control"
                        value={due_date}
                        onChange={(e) => this.setState({ due_date: e.target.value })}
                        required={!ongoing}
                      />
                    </div>
                  )}

                  {!isEdit && (
                    <div className="col-span-12 md:col-span-6">
                      <label className="form-label">
                        Already saved <span className="text-muted font-normal">(optional)</span>
                      </label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" className="form-control" min="0" step="0.01"
                          placeholder="0"
                          value={initial_balance}
                          onChange={(e) => this.setState({ initial_balance: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {isEdit && (
                    <>
                      <div className="col-span-12 md:col-span-5">
                        <label className="form-label">
                          Add to balance <span className="text-muted font-normal">(optional)</span>
                        </label>
                        <div className="input-group">
                          <span className="input-group-text">$</span>
                          <input
                            type="number" className="form-control" min="0.01" step="0.01"
                            placeholder="0.00"
                            value={add_amount}
                            onChange={(e) => this.setState({ add_amount: e.target.value })}
                          />
                        </div>
                      </div>
                      {add_amount && parseFloat(add_amount) > 0 && (
                        <div className="col-span-12 md:col-span-7">
                          <label className="form-label">Description</label>
                          <input
                            className="form-control"
                            placeholder="e.g. Initial deposit"
                            value={add_description}
                            onChange={(e) => this.setState({ add_description: e.target.value })}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {error && <div className="alert alert-danger py-2 mb-0 mt-3">{error}</div>}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim() || !target}>
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
