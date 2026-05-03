import { Component, createRef } from "react";
import type { Category, CurrencyOption, PaymentMethod, Transaction, TransactionLine } from "../types";

type CategoryWithSF = Category & { is_sinking_fund?: boolean };

interface Props {
  categories: Category[];
  paymentMethods: PaymentMethod[];
  currencies: CurrencyOption[];
  userCurrency: string;
  budgetPk: number;
  onSave: (data: Partial<Transaction>) => Promise<void>;
  transaction?: Transaction | null;
  onClose: () => void;
  defaultCategoryType?: "income" | "expense";
}

interface LineState {
  category: string;
  amount: string;
  description: string;
}

interface State {
  description: string;
  due_date: string;
  paid_date: string;
  is_paid: boolean;
  notes: string;
  payment_method: string;
  currency: string;
  lines: LineState[];
  saving: boolean;
  errors: Record<string, string[]>;
  categoryType: "income" | "expense";
}

class TransactionModal extends Component<Props, State> {
  private modalRef = createRef<HTMLDivElement>();

  constructor(props: Props) {
    super(props);
    this.state = this.buildInitialState(props.transaction);
  }

  buildInitialState(transaction?: Transaction | null): State {
    if (transaction) {
      return {
        description: transaction.description,
        due_date: transaction.due_date,
        paid_date: transaction.paid_date ?? "",
        is_paid: transaction.transaction_type === "income" || !transaction.recurring ? true : transaction.is_paid,
        notes: transaction.notes,
        payment_method: transaction.payment_method ? String(transaction.payment_method) : "",
        currency: transaction.currency || this.props.userCurrency,
        lines: transaction.lines.map((l) => ({
          category: String(l.category),
          amount: l.amount,
          description: l.description,
        })),
        saving: false,
        errors: {},
        categoryType: transaction.transaction_type === "income" ? "income" : "expense",
      };
    }
    const { defaultCategoryType, categories, userCurrency } = this.props;
    const resolvedType: "income" | "expense" = defaultCategoryType ?? "expense";
    const defaultCategory = String(categories.find((c) => c.category_type === resolvedType)?.id ?? "");
    return {
      description: "",
      due_date: new Date().toISOString().split("T")[0],
      paid_date: new Date().toISOString().split("T")[0],
      is_paid: true,
      notes: "",
      payment_method: "",
      currency: userCurrency,
      lines: [{ category: defaultCategory, amount: "", description: "" }],
      saving: false,
      errors: {},
      categoryType: resolvedType,
    };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.transaction !== this.props.transaction) {
      this.setState(this.buildInitialState(this.props.transaction));
    }
  }

  handleLineChange(index: number, field: keyof LineState, value: string) {
    const lines = [...this.state.lines];
    lines[index] = { ...lines[index], [field]: value };
    this.setState({ lines });
  }

  addLine() {
    this.setState((prev) => ({
      lines: [...prev.lines, { category: "", amount: "", description: "" }],
    }));
  }

  removeLine(index: number) {
    this.setState((prev) => ({
      lines: prev.lines.filter((_, i) => i !== index),
    }));
  }

  async handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { description, due_date, paid_date, is_paid, notes, payment_method, currency, lines, categoryType } = this.state;

    const payload: Partial<Transaction> = {
      description,
      due_date,
      paid_date: paid_date || null,
      is_paid,
      notes,
      transaction_type: categoryType,
      payment_method: payment_method ? parseInt(payment_method, 10) : null,
      currency,
      lines: lines.map((l) => ({
        category: parseInt(l.category, 10),
        amount: l.amount,
        description: l.description,
      })) as TransactionLine[],
    };

    this.setState({ saving: true, errors: {} });
    try {
      await this.props.onSave(payload);
      this.setState(this.buildInitialState());
      this.props.onClose();
    } catch (err: unknown) {
      this.setState({ errors: err as Record<string, string[]>, saving: false });
    }
  }

  render() {
    const { categories, paymentMethods, currencies, userCurrency, transaction, onClose } = this.props;
    const { description, due_date, paid_date, is_paid, payment_method, currency, lines, saving, errors, categoryType } = this.state;
    const isForeignCurrency = currency !== userCurrency;
    const isEdit = Boolean(transaction);
    const isRecurring = Boolean(transaction?.recurring);
    // Sinking fund categories appear in both income and expense dropdowns
    const visibleCategories = (categories as CategoryWithSF[]).filter(
      (c) => c.category_type === categoryType || c.is_sinking_fund
    );
    const allLinesSF = lines.length > 0 && lines.every((l) => {
      const cat = (categories as CategoryWithSF[]).find((c) => String(c.id) === l.category);
      return cat?.is_sinking_fund === true;
    });

    return (
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        ref={this.modalRef}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="modal-dialog modal-lg" role="document">
          <div className="modal-content">
            <form onSubmit={(e) => { void this.handleSubmit(e); }}>
              <div className="modal-header">
                <h5 className="modal-title">{isEdit ? "Edit Transaction" : categoryType === "income" ? (allLinesSF ? "Deposit to Fund" : "Add Income") : "Add Expense"}</h5>
                <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
              </div>
              <div className="modal-body">
                {errors.non_field_errors && (
                  <div className="alert alert-danger">{errors.non_field_errors.join(" ")}</div>
                )}

                {!isEdit && (
                  <div className="mb-3">
                    <div className="btn-group w-100" role="group">
                      {(["expense", "income"] as const).map((t) => (
                        <label
                          key={t}
                          className={`btn ${categoryType === t ? (t === "expense" ? "btn-danger" : allLinesSF ? "btn-warning" : "btn-success") : "btn-outline-secondary"}`}
                          style={{ textTransform: "capitalize" }}
                        >
                          <input
                            type="radio"
                            name="categoryType"
                            value={t}
                            checked={categoryType === t}
                            onChange={() => {
                              this.setState({
                                categoryType: t,
                                lines: [{ category: "", amount: "", description: "" }],
                              });
                            }}
                            style={{ display: "none" }}
                          />
                          {t === "income" && allLinesSF ? "Deposit" : t}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mb-3">
                  <label className="form-label">Description</label>
                  <input
                    type="text"
                    className={`form-control ${errors.description ? "is-invalid" : ""}`}
                    value={description}
                    onChange={(e) => { this.setState({ description: e.target.value }); }}
                    required
                  />
                  {errors.description && <div className="invalid-feedback">{errors.description.join(" ")}</div>}
                </div>

                <div className="row">
                  {isRecurring && (
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Due Date</label>
                      <input
                        type="date"
                        className={`form-control ${errors.due_date ? "is-invalid" : ""}`}
                        value={due_date}
                        onChange={(e) => { this.setState({ due_date: e.target.value }); }}
                        required
                      />
                      {errors.due_date && <div className="invalid-feedback">{errors.due_date.join(" ")}</div>}
                    </div>
                  )}
                  <div className="col-md-6 mb-3">
                    <label className="form-label">{categoryType === "income" ? "Received Date" : "Paid Date"}</label>
                    <input
                      type="date"
                      className="form-control"
                      value={paid_date}
                      onChange={(e) => { this.setState({ paid_date: e.target.value }); }}
                    />
                  </div>
                </div>

                {isRecurring && categoryType !== "income" && (
                  <div className="mb-3 form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="modal-is-paid"
                      checked={is_paid}
                      onChange={(e) => { this.setState({ is_paid: e.target.checked }); }}
                    />
                    <label className="form-check-label" htmlFor="modal-is-paid">Mark as Paid</label>
                  </div>
                )}

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Payment Method</label>
                    <select
                      className="form-select"
                      value={payment_method}
                      onChange={(e) => { this.setState({ payment_method: e.target.value }); }}
                    >
                      <option value="">— None —</option>
                      {paymentMethods.filter((m) => m.is_active).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.last_four ? ` ···${m.last_four}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Currency</label>
                    <select
                      className="form-select"
                      value={currency}
                      onChange={(e) => { this.setState({ currency: e.target.value }); }}
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                    {isForeignCurrency && (
                      <div className="form-text">Amounts will be converted from {currency} to {userCurrency}</div>
                    )}
                  </div>
                </div>



                <hr />
                <h6>Line Items</h6>
                {errors.lines && (
                  <div className="alert alert-danger">{(errors.lines as unknown as string[]).join(" ")}</div>
                )}
                {lines.map((line, idx) => (
                  <div key={idx} className="row g-2 mb-2 align-items-end">
                    <div className="col-md-5">
                      <label className="form-label small">Category</label>
                      <select
                        className="form-select"
                        value={line.category}
                        onChange={(e) => { this.handleLineChange(idx, "category", e.target.value); }}
                        required
                      >
                        <option value="">-- Select --</option>
                        {visibleCategories.map((c) => (
                          <option key={c.id} value={c.id}>{(c as CategoryWithSF).is_sinking_fund ? `◎ ${c.name}` : c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small">Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-control"
                        value={line.amount}
                        onChange={(e) => { this.handleLineChange(idx, "amount", e.target.value); }}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small">Note</label>
                      <input
                        type="text"
                        className="form-control"
                        value={line.description}
                        onChange={(e) => { this.handleLineChange(idx, "description", e.target.value); }}
                      />
                    </div>
                    <div className="col-md-1">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => { this.removeLine(idx); }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-sm btn-outline-secondary mt-1" onClick={() => { this.addLine(); }}>
                  + Add Line
                </button>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }
}

export default TransactionModal;
