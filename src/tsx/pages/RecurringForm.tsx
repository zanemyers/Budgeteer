import { useState } from "react";
import { router } from "@inertiajs/react";

interface Category {
  id: number;
  name: string;
  category_type: "income" | "expense";
  monthly_budget: string;
}

interface PaymentMethod {
  id: number;
  name: string;
  payment_type: string;
  payment_type_display: string;
  last_four: string;
  is_active: boolean;
}

interface RecurringTransaction {
  id: number;
  name: string;
  description: string;
  amount: string;
  category: number;
  frequency: string;
  interval: number;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  payment_method: number | null;
}

interface FreqChoice {
  value: string;
  label: string;
}

interface Props {
  budget_pk: number;
  recurring: RecurringTransaction | null;
  categories: Category[];
  payment_methods: PaymentMethod[];
  freq_choices: FreqChoice[];
  errors?: Record<string, string[]>;
  values?: Record<string, unknown>;
}

export default function RecurringForm({ budget_pk, recurring, categories, payment_methods, freq_choices, errors = {}, values }: Props) {
  const isEdit = recurring !== null;

  const [name, setName] = useState(String(values?.name ?? recurring?.name ?? ""));
  const [category, setCategory] = useState(String(values?.category ?? recurring?.category ?? ""));
  const [amount, setAmount] = useState(String(values?.amount ?? recurring?.amount ?? ""));
  const [frequency, setFrequency] = useState(String(values?.frequency ?? recurring?.frequency ?? freq_choices[0]?.value ?? "monthly"));
  const [interval, setInterval] = useState(String(values?.interval ?? recurring?.interval ?? "1"));
  const [startDate, setStartDate] = useState(String(values?.start_date ?? recurring?.start_date ?? new Date().toISOString().split("T")[0]));
  const [endDate, setEndDate] = useState(String(values?.end_date ?? recurring?.end_date ?? ""));
  const [description, setDescription] = useState(String(values?.description ?? recurring?.description ?? ""));
  const [paymentMethod, setPaymentMethod] = useState(String(values?.payment_method ?? recurring?.payment_method ?? ""));
  const [isActive, setIsActive] = useState(Boolean(values?.is_active ?? recurring?.is_active ?? true));
  const [deleteFutureUnpaid, setDeleteFutureUnpaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const payload: Record<string, string | number | boolean | null> = {
      name,
      category: parseInt(category),
      amount,
      frequency,
      start_date: startDate,
      is_active: isActive,
    };
    if (frequency === "every_n_months") payload.interval = parseInt(interval);
    if (endDate) payload.end_date = endDate;
    if (description) payload.description = description;
    if (paymentMethod) payload.payment_method = parseInt(paymentMethod);
    if (isEdit && deleteFutureUnpaid) payload.delete_future_unpaid = true;

    const url = isEdit
      ? `/budgets/${budget_pk}/recurring/${recurring.id}/edit/`
      : `/budgets/${budget_pk}/recurring/create/`;

    router.post(url, payload, {
      onFinish: () => setSubmitting(false),
    });
  }

  function fieldError(field: string): string | null {
    return errors[field]?.[0] ?? null;
  }

  return (
    <div className="row justify-content-center">
      <div className="col-md-7">
        <h1 className="h3 mb-4">{isEdit ? "Edit Recurring Transaction" : "New Recurring Transaction"}</h1>

        <form onSubmit={handleSubmit}>
          {isEdit && (
            <div className="form-check mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="delete_future_unpaid"
                checked={deleteFutureUnpaid}
                onChange={(e) => setDeleteFutureUnpaid(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="delete_future_unpaid">
                Also delete and regenerate future unpaid instances with new settings
              </label>
            </div>
          )}

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-name">Name <span className="text-danger">*</span></label>
            <input
              id="rt-name"
              className={`form-control ${fieldError("name") ? "is-invalid" : ""}`}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              required
            />
            {fieldError("name") && <div className="invalid-feedback">{fieldError("name")}</div>}
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-category">Category <span className="text-danger">*</span></label>
            <select
              id="rt-category"
              className={`form-select ${fieldError("category") ? "is-invalid" : ""}`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            >
              <option value="">-- Select --</option>
              <optgroup label="Income">
                {categories.filter((c) => c.category_type === "income").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Expense">
                {categories.filter((c) => c.category_type === "expense").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            </select>
            {fieldError("category") && <div className="invalid-feedback">{fieldError("category")}</div>}
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-amount">Amount <span className="text-danger">*</span></label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input
                id="rt-amount"
                type="number"
                step="0.01"
                min="0.01"
                className={`form-control ${fieldError("amount") ? "is-invalid" : ""}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {fieldError("amount") && <div className="invalid-feedback">{fieldError("amount")}</div>}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-frequency">Frequency <span className="text-danger">*</span></label>
            <select
              id="rt-frequency"
              className={`form-select ${fieldError("frequency") ? "is-invalid" : ""}`}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              {freq_choices.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {fieldError("frequency") && <div className="invalid-feedback">{fieldError("frequency")}</div>}
          </div>

          {frequency === "every_n_months" && (
            <div className="mb-3">
              <label className="form-label" htmlFor="rt-interval">Every (months) <span className="text-danger">*</span></label>
              <input
                id="rt-interval"
                type="number"
                min={2}
                className={`form-control ${fieldError("interval") ? "is-invalid" : ""}`}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
              />
              {fieldError("interval") && <div className="invalid-feedback">{fieldError("interval")}</div>}
            </div>
          )}

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-start-date">Start Date <span className="text-danger">*</span></label>
            <input
              id="rt-start-date"
              type="date"
              className={`form-control ${fieldError("start_date") ? "is-invalid" : ""}`}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            {fieldError("start_date") && <div className="invalid-feedback">{fieldError("start_date")}</div>}
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-end-date">End Date</label>
            <input
              id="rt-end-date"
              type="date"
              className="form-control"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-payment-method">Payment Method</label>
            <select
              id="rt-payment-method"
              className="form-select"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="">— None —</option>
              {payment_methods.map((pm) => (
                <option key={pm.id} value={pm.id}>
                  {pm.last_four ? `${pm.name} ···· ${pm.last_four}` : pm.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="rt-description">Description</label>
            <textarea
              id="rt-description"
              className="form-control"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {isEdit && (
            <div className="mb-3 form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="rt-is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="rt-is-active">Active</label>
            </div>
          )}

          {Object.keys(errors).length > 0 && (
            <div className="alert alert-danger py-2 small">
              {Object.values(errors).flat().join(" ")}
            </div>
          )}

          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {isEdit ? "Save Changes" : "Create"}
            </button>
            <a
              href={isEdit ? `/budgets/${budget_pk}/recurring/${recurring.id}/` : `/budgets/${budget_pk}/recurring/`}
              className="btn btn-link"
              onClick={(e) => {
                e.preventDefault();
                router.visit(isEdit ? `/budgets/${budget_pk}/recurring/${recurring!.id}/` : `/budgets/${budget_pk}/recurring/`);
              }}
            >
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
