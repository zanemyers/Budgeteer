import { router } from "@inertiajs/react";
import { useState } from "react";
import TransactionModal from "../components/TransactionModal";
import type { BudgetOverview, BudgetOverviewCategory, Category, PaymentMethod, Transaction } from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";

interface Props {
  budget_pk: number;
  month: string;
  overview: BudgetOverview;
  categories: Category[];
  payment_methods: PaymentMethod[];
}

function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 1) return `${year - 1}-12`;
  return `${year}-${String(mon - 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 12) return `${year + 1}-01`;
  return `${year}-${String(mon + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export default function SinkingFunds({ budget_pk, month, overview, categories, payment_methods }: Props) {
  const symbol = useCurrencySymbol();
  const [addTransactionType, setAddTransactionType] = useState<"income" | "expense" | null>(null);

  const isCurrentMonth = month === getDefaultMonth();

  function navigateMonth(m: string) {
    router.get(`/budgets/${budget_pk}/sinking-funds/`, { month: m }, { preserveState: false });
  }

  async function createTransaction(data: Partial<Transaction>) {
    const res = await fetch(`/budgets/${budget_pk}/transactions/create/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json() as { errors?: Record<string, string[]> };
      throw json.errors ?? json;
    }
    router.reload({ only: ["overview"] });
  }

  function renderSinkingFundCard(cat: BudgetOverviewCategory) {
    const target = parseFloat(cat.sinking_fund_target ?? "0");
    const saved = parseFloat(cat.sinking_fund_total_saved ?? "0");
    const credited = parseFloat(cat.sinking_fund_total_credited ?? "0");
    const monthly = parseFloat(cat.sinking_fund_monthly ?? "0");
    const isOngoing = cat.sinking_fund_ongoing;
    const isComplete = isOngoing ? saved >= target : credited >= target;
    const pct = isComplete ? 100 : target > 0 ? Math.min((saved / target) * 100, 100) : 0;

    const activity = parseFloat(cat.activity);
    const dueDate = !isOngoing && cat.sinking_fund_due_date ? new Date(cat.sinking_fund_due_date + "T00:00:00") : null;
    const dueMeta = !isOngoing && dueDate
      ? (isComplete ? "" : `due ${dueDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · ${cat.sinking_fund_months_remaining}mo left`)
      : isOngoing ? "↺ ongoing" : "";

    const showMonthly = monthly > 0 && !isComplete;
    const barColor = isComplete ? "bg-success" : isOngoing ? "bg-info" : "bg-warning";

    return (
      <div key={cat.id} className="px-3 py-2">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="d-flex align-items-center gap-1 mb-1">
              <a href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`} className="text-decoration-none text-body fw-medium small">
                {cat.name}
              </a>
              {isComplete && <span className="text-success" style={{ fontSize: "0.75rem" }}>✔</span>}
            </div>
            <div className="progress" style={{ height: 6, borderRadius: 3 }}>
              <div className={`progress-bar ${barColor}`} style={{ width: `${pct}%`, borderRadius: 3 }} />
            </div>
          </div>
          <div className="text-end flex-shrink-0" style={{ width: 160 }}>
            <div className="small fw-medium">{fmt(String(saved), symbol)} <span className="text-muted fw-normal">/ {fmt(String(target), symbol)}</span></div>
            {showMonthly && (
              <div className="small" style={{ color: "var(--bs-warning-text-emphasis, #997404)" }}>
                {fmt(String(monthly), symbol)}/mo
              </div>
            )}
            {activity !== 0 && (
              <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                {fmt(String(activity), symbol)} spent total
              </div>
            )}
            {dueMeta && <div className="text-muted" style={{ fontSize: "0.7rem" }}>{dueMeta}</div>}
          </div>
        </div>
      </div>
    );
  }

  const sinkingFunds = overview.categories.filter((c) => c.is_sinking_fund);
  const totalSaved = sinkingFunds.reduce((sum, c) => sum + parseFloat(c.sinking_fund_total_saved ?? "0"), 0);
  const totalTarget = sinkingFunds.reduce((sum, c) => sum + parseFloat(c.sinking_fund_target ?? "0"), 0);

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <h4 className="mb-0">Sinking Funds</h4>
        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(prevMonth(month))}>&laquo;</button>
          <span className="small text-muted">{formatMonth(month)}</span>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(nextMonth(month))} disabled={isCurrentMonth}>&raquo;</button>
        </div>
      </div>

      {sinkingFunds.length === 0 ? (
        <div className="text-muted text-center py-5">
          No sinking funds yet. <a href={`/budgets/${budget_pk}/categories/`}>Add one in Categories.</a>
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-md-8">
            <div className="card">
              <div className="card-header bg-warning bg-opacity-10 d-flex justify-content-between align-items-center">
                <span className="text-warning-emphasis small fw-bold">All Funds</span>
                <div className="d-flex gap-2">
                  <button className="btn btn-outline-success btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("income")}>+ Deposit</button>
                  <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("expense")}>− Spend</button>
                </div>
              </div>
              <div className="d-flex flex-column" style={{ gap: "1px", background: "var(--bs-border-color)" }}>
                {sinkingFunds.map((cat) => (
                  <div key={cat.id} style={{ background: "var(--bs-card-bg, var(--bs-body-bg))" }}>
                    {renderSinkingFundCard(cat)}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-md-4">
            <div className="card">
              <div className="card-body py-2">
                <div className="d-flex justify-content-between align-items-center py-1">
                  <span className="small text-muted">Total saved</span>
                  <span className="fw-semibold text-success">{fmt(totalSaved, symbol)}</span>
                </div>
                <div className="d-flex justify-content-between align-items-center py-1">
                  <span className="small text-muted">Total target</span>
                  <span className="fw-semibold">{fmt(totalTarget, symbol)}</span>
                </div>
                <hr className="my-1" />
                <div className="d-flex justify-content-between align-items-center py-1">
                  <span className="small text-muted">Saved to funds {formatMonth(month)}</span>
                  <span className="fw-semibold text-warning">{fmt(overview.transfers_total, symbol)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {addTransactionType !== null && (
        <>
          <div className="modal-backdrop fade show" onClick={() => setAddTransactionType(null)} />
          <TransactionModal
            categories={categories}
            paymentMethods={payment_methods}
            budgetPk={budget_pk}
            transaction={null}
            defaultCategoryType={addTransactionType}
            onSave={createTransaction}
            onClose={() => setAddTransactionType(null)}
          />
        </>
      )}
    </div>
  );
}
