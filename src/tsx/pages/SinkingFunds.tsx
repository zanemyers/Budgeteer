import { router } from "@inertiajs/react";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pencil, RotateCcw } from "lucide-react";
import SinkingFundModal, { type SinkingFundCategory } from "../components/SinkingFundModal";
import TransactionModal from "../components/TransactionModal";
import type { BudgetOverview, BudgetOverviewCategory, Category, CurrencyOption, PaymentMethod, Transaction } from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";
import { formatMonth, getDefaultMonth, nextMonth, prevMonth } from "../utils/month";
import { getCsrfToken } from "../lib/api";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const SECTION_LABEL_CLASS = "text-[0.6875rem] font-semibold uppercase tracking-[0.08em]";

interface Props {
  budget_pk: number;
  month: string;
  overview: BudgetOverview;
  categories: Category[];
  payment_methods: PaymentMethod[];
  currencies: CurrencyOption[];
  user_currency: string;
}

// Convert an overview-shaped fund row into the shape SinkingFundModal expects.
function toSFCategory(cat: BudgetOverviewCategory): SinkingFundCategory {
  return {
    id: cat.id,
    name: cat.name,
    category_type: cat.category_type,
    parent_id: cat.parent_id,
    monthly_budget: cat.budgeted,
    is_sinking_fund: cat.is_sinking_fund,
    sinking_fund_target: cat.sinking_fund_target,
    sinking_fund_due_date: cat.sinking_fund_due_date,
    sinking_fund_ongoing: cat.sinking_fund_ongoing,
    sinking_fund_monthly_goal: cat.sinking_fund_monthly_goal,
    total_saved: cat.sinking_fund_total_saved ?? "0",
  };
}

export default function SinkingFunds({ budget_pk, month, overview, categories, payment_methods, currencies, user_currency }: Props) {
  const symbol = useCurrencySymbol();
  const [addTransactionType, setAddTransactionType] = useState<"income" | "expense" | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BudgetOverviewCategory | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

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

  async function handleDelete(cat: BudgetOverviewCategory) {
    const res = await fetch(`/budgets/${budget_pk}/categories/${cat.id}/delete/`, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    if (res.ok || res.status === 204) {
      router.reload({ only: ["overview", "categories"] });
    } else {
      setDeleteError((prev) => ({ ...prev, [cat.id]: "Cannot delete — goal has transactions." }));
    }
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
    const barColor = isComplete ? "bg-moss" : isOngoing ? "bg-ongoing" : "bg-fund";

    return (
      <div key={cat.id} className="px-5 py-3 border-t border-rule first:border-t-0 group">
        <div className="flex justify-between items-start gap-4">
          <div className="grow min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <a href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`} className="no-underline hover:underline font-medium text-sm">
                {cat.name}
              </a>
              {isComplete && <Check className="size-3.5 text-moss" aria-label="Complete" />}
              {isOngoing && !isComplete && <RotateCcw className="size-3.5 text-ongoing" aria-label="Ongoing" />}
            </div>
            <div className="h-1.5 rounded-full bg-surface-strong overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            {deleteError[cat.id] && <p className="text-alarm text-xs mt-1">{deleteError[cat.id]}</p>}
          </div>
          <div className="text-right shrink-0 w-44">
            <div className="text-sm font-medium tabular-nums">
              {fmt(String(saved), symbol)} <span className="text-ink-quiet font-normal">/ {fmt(String(target), symbol)}</span>
            </div>
            {showMonthly && (
              <div className="text-sm text-fund tabular-nums">
                {fmt(String(monthly), symbol)}/mo
              </div>
            )}
            {activity !== 0 && (
              <div className="text-ink-quiet text-[0.7rem] tabular-nums">
                {fmt(String(activity), symbol)} spent total
              </div>
            )}
            {dueMeta && <div className="text-ink-quiet text-[0.7rem]">{dueMeta}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(cat)} aria-label="Edit goal"><Pencil /></Button>
            <ConfirmButton size="xs" onConfirm={() => handleDelete(cat)} label="Delete" />
          </div>
        </div>
      </div>
    );
  }

  const sinkingFunds = overview.categories.filter((c) => c.is_sinking_fund);
  const totalSaved = sinkingFunds.reduce((sum, c) => sum + parseFloat(c.sinking_fund_total_saved ?? "0"), 0);
  const totalTarget = sinkingFunds.reduce((sum, c) => sum + parseFloat(c.sinking_fund_target ?? "0"), 0);

  return (
    <div className="max-w-[1200px]">
      <header className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => navigateMonth(prevMonth(month))} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <span className="text-sm text-ink-quiet tabular-nums">{formatMonth(month)}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => navigateMonth(nextMonth(month))} disabled={isCurrentMonth} aria-label="Next month">
            <ChevronRight />
          </Button>
          <Button onClick={() => setAdding(true)} className="ml-2">+ Add Goal</Button>
        </div>
      </header>

      {sinkingFunds.length === 0 ? (
        <div className="text-ink-quiet text-center py-16">
          <p className="mb-4">No goals yet. Start saving toward something.</p>
          <Button onClick={() => setAdding(true)}>Add a goal</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <Card className="md:col-span-8 p-0 gap-0 overflow-hidden border-rule shadow-none">
            <div className="bg-fund-soft px-4 py-2 flex justify-between items-center">
              <span className={`${SECTION_LABEL_CLASS} text-ink`}>All Goals</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="xs" onClick={() => setAddTransactionType("income")}>+ Deposit</Button>
                <Button variant="ghost" size="xs" onClick={() => setAddTransactionType("expense")}>− Spend</Button>
              </div>
            </div>
            <div>{sinkingFunds.map((cat) => renderSinkingFundCard(cat))}</div>
          </Card>
          <Card className="md:col-span-4 p-0 border-rule shadow-none h-fit">
            <div className="px-5 py-4 flex flex-col gap-2">
              <span className={`${SECTION_LABEL_CLASS} text-ink-quiet mb-1`}>Totals</span>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-ink-quiet">Saved</span>
                <span className="font-medium text-moss tabular-nums">{fmt(totalSaved, symbol)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-ink-quiet">Target</span>
                <span className="font-medium tabular-nums">{fmt(totalTarget, symbol)}</span>
              </div>
              <hr className="my-1.5 border-rule" />
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-ink-quiet">{formatMonth(month)}</span>
                <span className="font-medium text-fund tabular-nums">{fmt(overview.transfers_total, symbol)}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {addTransactionType !== null && (
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
      )}

      {(adding || editing) && (
        <SinkingFundModal
          budgetPk={budget_pk}
          fund={editing ? toSFCategory(editing) : null}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.reload({ only: ["overview", "categories"] });
          }}
        />
      )}
    </div>
  );
}
