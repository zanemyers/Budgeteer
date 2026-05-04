import { router } from "@inertiajs/react";
import { useState } from "react";
import TransactionModal from "../components/TransactionModal";
import type { BudgetOverview, BudgetOverviewCategory, Category, CurrencyOption, PaymentMethod, Transaction } from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";

interface Props {
  budget_pk: number;
  month: string;
  overview: BudgetOverview;
  categories: Category[];
  payment_methods: PaymentMethod[];
  currencies: CurrencyOption[];
  user_currency: string;
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

export default function SinkingFunds({ budget_pk, month, overview, categories, payment_methods, currencies, user_currency }: Props) {
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
      <div key={cat.id} className="px-4 py-2">
        <div className="flex justify-between items-start gap-4">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-1 mb-1">
              <a href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`} className="no-underline text-body font-medium text-sm">
                {cat.name}
              </a>
              {isComplete && <span className="text-success" style={{ fontSize: "0.75rem" }}>✔</span>}
            </div>
            <div className="progress" style={{ height: 6, borderRadius: 3 }}>
              <div className={`progress-bar ${barColor}`} style={{ width: `${pct}%`, borderRadius: 3 }} />
            </div>
          </div>
          <div className="text-right shrink-0" style={{ width: 160 }}>
            <div className="text-sm font-medium">{fmt(String(saved), symbol)} <span className="text-muted font-normal">/ {fmt(String(target), symbol)}</span></div>
            {showMonthly && (
              <div className="text-sm" style={{ color: "var(--bs-warning-text-emphasis, #997404)" }}>
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
      <div className="flex items-center justify-between mb-6">
        <h4 className="mb-0">Sinking Funds</h4>
        <div className="flex items-center gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(prevMonth(month))}>&laquo;</button>
          <span className="text-sm text-muted">{formatMonth(month)}</span>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigateMonth(nextMonth(month))} disabled={isCurrentMonth}>&raquo;</button>
        </div>
      </div>

      {sinkingFunds.length === 0 ? (
        <div className="text-muted text-center py-12">
          No sinking funds yet. <a href={`/budgets/${budget_pk}/categories/`}>Add one in Categories.</a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-8">
            <div className="card">
              <div className="card-header bg-warning bg-opacity-10 flex justify-between items-center">
                <span className="text-warning-emphasis text-sm font-bold">All Funds</span>
                <div className="flex gap-2">
                  <button className="btn btn-outline-success btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("income")}>+ Deposit</button>
                  <button className="btn btn-outline-danger btn-sm py-0 px-2" style={{ fontSize: "0.75rem" }} onClick={() => setAddTransactionType("expense")}>− Spend</button>
                </div>
              </div>
              <div className="flex flex-col" style={{ gap: "1px", background: "var(--bs-border-color)" }}>
                {sinkingFunds.map((cat) => (
                  <div key={cat.id} style={{ background: "var(--bs-card-bg, var(--bs-body-bg))" }}>
                    {renderSinkingFundCard(cat)}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="md:col-span-4">
            <div className="card">
              <div className="card-body py-2">
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-muted">Total saved</span>
                  <span className="font-semibold text-success">{fmt(totalSaved, symbol)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-muted">Total target</span>
                  <span className="font-semibold">{fmt(totalTarget, symbol)}</span>
                </div>
                <hr className="my-1" />
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-muted">Saved to funds {formatMonth(month)}</span>
                  <span className="font-semibold text-warning">{fmt(overview.transfers_total, symbol)}</span>
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
            currencies={currencies}
            userCurrency={user_currency}
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
