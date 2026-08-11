import { router } from "@inertiajs/react";
import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { MonthLabel } from "@/components/MonthLabel";
import { RowActions } from "@/components/RowActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import GoalModal, { type GoalCategory } from "../components/GoalModal";
import { PageTourButton } from "../components/PageTourButton";
import TransactionModal from "../components/TransactionModal";
import { errorMessage, jsonFetch } from "../lib/api";
import { usePageTour } from "../lib/onboardingTour";
import type {
  BudgetOverview,
  BudgetOverviewCategory,
  Category,
  CurrencyOption,
  PaymentMethod,
  Transaction,
} from "../types";
import { fmt, useCurrencySymbol } from "../utils/currency";
import { isGoalComplete } from "../utils/goals";
import { formatMonth, getDefaultMonth, nextMonth, prevMonth } from "../utils/month";

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

// Convert an overview-shaped goal row into the shape GoalModal expects.
function toGoalCategory(cat: BudgetOverviewCategory): GoalCategory {
  return {
    id: cat.id,
    name: cat.name,
    category_type: cat.category_type,
    parent_id: cat.parent_id,
    monthly_budget: cat.budgeted,
    rollover: cat.rollover,
    // The overview serializer doesn't carry these two, and a goal never uses rollover
    // accrual anyway, so they're filled with the model defaults rather than left missing.
    base_amount: "0.00",
    rollover_start: null,
    is_goal: cat.is_goal,
    goal_target: cat.goal_target,
    goal_due_date: cat.goal_due_date,
    goal_ongoing: cat.goal_ongoing,
    goal_monthly: cat.goal_monthly,
    total_saved: cat.goal_total_saved ?? "0",
  };
}

export default function Goals({
  budget_pk,
  month,
  overview,
  categories,
  payment_methods,
  currencies,
  user_currency,
}: Props) {
  usePageTour("goals", budget_pk);
  const symbol = useCurrencySymbol();
  const [addTransactionType, setAddTransactionType] = useState<"deposit" | "expense" | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BudgetOverviewCategory | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  const isCurrentMonth = month === getDefaultMonth();

  function navigateMonth(m: string) {
    router.get(`/budgets/${budget_pk}/goals/`, { month: m }, { preserveState: false });
  }

  async function createTransaction(data: Partial<Transaction>) {
    // jsonFetch throws the same shape this built by hand; the modal needs the throw to
    // render its field errors.
    await jsonFetch(`/budgets/${budget_pk}/transactions/create/`, "POST", data);
    router.reload({ only: ["overview"] });
  }

  async function handleDelete(cat: BudgetOverviewCategory) {
    try {
      await jsonFetch(`/budgets/${budget_pk}/categories/${cat.id}/delete/`, "DELETE");
      router.reload({ only: ["overview", "categories"] });
    } catch (err) {
      // The view already explains why a delete was refused; asserting "has transactions"
      // here was a guess that also covered 500s and network failures.
      setDeleteError((prev) => ({ ...prev, [cat.id]: errorMessage(err, "Couldn't delete that goal.") }));
    }
  }

  function renderGoalCard(cat: BudgetOverviewCategory) {
    const target = parseFloat(cat.goal_target ?? "0");
    const saved = parseFloat(cat.goal_total_saved ?? "0");
    const monthly = parseFloat(cat.goal_monthly_needed ?? "0");
    const isOngoing = cat.goal_ongoing;
    const isComplete = isGoalComplete(cat);
    const pct = isComplete ? 100 : target > 0 ? Math.min((saved / target) * 100, 100) : 0;

    const activity = parseFloat(cat.activity);
    // A funded goal has nothing left to say about its target, so it drops off. For a one-off goal
    // that has started being spent, what's left is only meaningful against what went out, so the
    // target's place is taken by the spend — which then stops repeating on its own line below.
    const showSpentAgainstHeld = isComplete && !isOngoing && activity !== 0;
    const dueDate = !isOngoing && cat.goal_due_date ? new Date(`${cat.goal_due_date}T00:00:00`) : null;
    const dueMeta =
      !isOngoing && dueDate
        ? isComplete
          ? ""
          : `due ${dueDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · ${cat.goal_months_remaining}mo left`
        : isOngoing
          ? "ongoing"
          : "";

    const showMonthly = monthly > 0 && !isComplete;
    const barColor = isComplete ? "bg-moss" : isOngoing ? "bg-ongoing" : "bg-fund";

    return (
      <div key={cat.id} className="px-4 md:px-5 py-3 border-t border-rule first:border-t-0 group">
        <div className="flex justify-between items-start gap-2 md:gap-4">
          <div className="grow min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              {/* All time, not this month: every figure on this card is a lifetime total, so a
                  month-scoped list would contradict the number that was clicked. */}
              <a
                href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}&all=1`}
                className="no-underline hover:underline font-medium text-sm"
              >
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
          <div className="text-right shrink-0 w-36 md:w-44">
            <div className="text-sm font-medium tabular-nums">
              {fmt(String(saved), symbol)}
              {!isComplete && <span className="text-ink-quiet font-normal"> / {fmt(String(target), symbol)}</span>}
              {showSpentAgainstHeld && (
                <span className="text-ink-quiet font-normal"> / {fmt(String(activity), symbol)} spent</span>
              )}
            </div>
            {showMonthly && <div className="text-sm text-fund tabular-nums">{fmt(String(monthly), symbol)}/mo</div>}
            {activity !== 0 && !showSpentAgainstHeld && (
              <div className="text-ink-quiet text-[0.7rem] tabular-nums">
                {fmt(String(activity), symbol)} spent total
              </div>
            )}
            {dueMeta && <div className="text-ink-quiet text-[0.7rem]">{dueMeta}</div>}
          </div>
          <div className="shrink-0 opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
            <RowActions
              name={cat.name}
              noun="goal"
              onEdit={() => setEditing(cat)}
              onDelete={() => handleDelete(cat)}
            />
          </div>
        </div>
      </div>
    );
  }

  const goals = overview.categories.filter((c) => c.is_goal);
  const totalSaved = goals.reduce((sum, c) => sum + parseFloat(c.goal_total_saved ?? "0"), 0);
  const totalTarget = goals.reduce((sum, c) => sum + parseFloat(c.goal_target ?? "0"), 0);

  return (
    <div className="max-w-[1200px]">
      {/* Same shape as Dashboard and Transactions: the month is the heading, the page's own name is
          left to the sidebar and the mobile breadcrumb. */}
      <header className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigateMonth(prevMonth(month))}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            <MonthLabel month={month} />
          </h1>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigateMonth(nextMonth(month))}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <PageTourButton stage="goals" />
          <Button data-tour="goal-add" onClick={() => setAdding(true)} aria-label="Add goal" title="Add goal">
            <Plus />
            <span className="hidden sm:inline">Add Goal</span>
          </Button>
        </div>
      </header>

      {goals.length === 0 ? (
        <div className="text-ink-quiet text-center py-16">
          <p className="mb-4">No goals yet. Start saving toward something.</p>
          <Button onClick={() => setAdding(true)}>Add a goal</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <Card data-tour="goal-card" className="md:col-span-8 p-0 gap-0 overflow-hidden">
            <div className="bg-fund-soft px-4 py-2 flex justify-between items-center">
              <span className={`${SECTION_LABEL_CLASS} text-ink`}>All Goals</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="xs" onClick={() => setAddTransactionType("deposit")}>
                  + Deposit
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setAddTransactionType("expense")}>
                  − Spend
                </Button>
              </div>
            </div>
            <div>{goals.map((cat) => renderGoalCard(cat))}</div>
          </Card>
          <Card className="md:col-span-4 p-0 h-fit">
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
                <span className="font-medium text-fund tabular-nums">{fmt(overview.saved_to_goals_total, symbol)}</span>
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
          transaction={null}
          defaultCategoryType="expense"
          forceTransactionType={addTransactionType === "deposit" ? "transfer" : undefined}
          onSave={createTransaction}
          onClose={() => setAddTransactionType(null)}
        />
      )}

      {(adding || editing) && (
        <GoalModal
          budgetPk={budget_pk}
          goal={editing ? toGoalCategory(editing) : null}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
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
