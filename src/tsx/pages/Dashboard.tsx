import { router } from "@inertiajs/react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AssignModal from "../components/AssignModal";
import CleanupAssignedModal from "../components/CleanupAssignedModal";
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
import { formatMonth, getDefaultMonth, isAtBackLimit, nextMonth, prevMonth } from "../utils/month";

interface Props {
  budget_pk: number;
  month: string;
  overview: BudgetOverview;
  categories: Category[];
  payment_methods: PaymentMethod[];
  pending_count: number;
  currencies: CurrencyOption[];
  user_currency: string;
  start_onboarding_tour?: boolean;
}

const SECTION_LABEL_CLASS = "text-[0.6875rem] font-semibold uppercase tracking-[0.08em]";

interface CurrencyEditCellProps {
  symbol: string;
  value: string;
  editing: string | undefined;
  onStart: () => void;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  saving: boolean;
  valueClass?: string;
  title?: string;
}

function CurrencyEditCell({
  symbol,
  value,
  editing,
  onStart,
  onChange,
  onCommit,
  onCancel,
  saving,
  valueClass,
  title,
}: CurrencyEditCellProps) {
  const numeric = parseFloat(value);
  if (editing !== undefined) {
    return (
      <div className="flex justify-end">
        <div className="flex items-center gap-0 max-w-[130px]">
          <span className="inline-flex items-center px-2 h-8 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
            {symbol}
          </span>
          <Input
            type="number"
            className="h-8 rounded-l-none"
            min="0"
            step="0.01"
            autoFocus
            value={editing}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
              if (e.key === "Escape") onCancel();
            }}
            onBlur={onCommit}
            disabled={saving}
          />
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="text-right cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      title={title}
      onClick={onStart}
    >
      {numeric > 0 ? (
        <span className={valueClass}>{fmt(value, symbol)}</span>
      ) : (
        <span className="text-muted-foreground italic">—</span>
      )}
    </button>
  );
}

export default function Dashboard({
  budget_pk,
  month,
  overview,
  categories,
  payment_methods,
  pending_count,
  currencies,
  user_currency,
  start_onboarding_tour,
}: Props) {
  const symbol = useCurrencySymbol();
  const [editingAssigned, setEditingAssigned] = useState<Record<number, string>>({});
  const [editingBudgeted, setEditingBudgeted] = useState<Record<number, string>>({});
  const [savingAssigned, setSavingAssigned] = useState<Record<number, boolean>>({});
  const [savingBudgeted, setSavingBudgeted] = useState<Record<number, boolean>>({});
  // The last value submitted per cell. The input commits on blur as well as Enter, so without
  // this a failed save — which deliberately keeps the cell editable so the typed value isn't
  // lost — re-sent the same value and re-toasted on every subsequent blur.
  const [lastTried, setLastTried] = useState<Record<string, string>>({});
  const [addTransactionType, setAddTransactionType] = useState<"income" | "expense" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  // First-run product tour: seeds the chained walkthrough (sidebar overview → each page).
  usePageTour("dashboard", budget_pk, { firstRun: !!start_onboarding_tour });

  const isCurrentMonth = month === getDefaultMonth();

  function navigateMonth(m: string) {
    router.get(`/budgets/${budget_pk}/`, { month: m }, { preserveState: false });
  }

  function clearEditAssigned(id: number) {
    setEditingAssigned((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function clearEditBudgeted(id: number) {
    setEditingBudgeted((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveAssigned(cat: BudgetOverviewCategory) {
    const val = editingAssigned[cat.id];
    if (val !== undefined && val === lastTried[`assigned:${cat.id}`]) return;
    // Nothing to do when the field is empty, or unchanged — it opens seeded with the persisted
    // value, so clicking in and out without editing would otherwise write on every blur.
    if (val === undefined || val === "" || val === cat.assigned) {
      clearEditAssigned(cat.id);
      return;
    }
    setSavingAssigned((prev) => ({ ...prev, [cat.id]: true }));
    setLastTried((prev) => ({ ...prev, [`assigned:${cat.id}`]: val }));
    try {
      await jsonFetch(`/budgets/${budget_pk}/category-budgets/${cat.id}/`, "PATCH", { assigned: val, month });
      // Only discard the edit buffer once the save actually landed. Clearing it in a
      // `finally` threw away what the user typed on failure and silently restored the old
      // number, which is indistinguishable from a successful save.
      clearEditAssigned(cat.id);
      router.reload({ only: ["overview"] });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save that amount."));
    } finally {
      setSavingAssigned((prev) => {
        const next = { ...prev };
        delete next[cat.id];
        return next;
      });
    }
  }

  async function saveBudgeted(cat: BudgetOverviewCategory) {
    const val = editingBudgeted[cat.id];
    if (val !== undefined && val === lastTried[`budgeted:${cat.id}`]) return;
    // Nothing to do when the field is empty, or unchanged — it opens seeded with the persisted
    // value, so clicking in and out without editing would otherwise write on every blur.
    if (val === undefined || val === "" || val === cat.budgeted) {
      clearEditBudgeted(cat.id);
      return;
    }
    setSavingBudgeted((prev) => ({ ...prev, [cat.id]: true }));
    setLastTried((prev) => ({ ...prev, [`budgeted:${cat.id}`]: val }));
    try {
      await jsonFetch(`/budgets/${budget_pk}/categories/${cat.id}/edit/`, "PATCH", { monthly_budget: val });
      clearEditBudgeted(cat.id);
      router.reload({ only: ["overview"] });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save that budget."));
    } finally {
      setSavingBudgeted((prev) => {
        const next = { ...prev };
        delete next[cat.id];
        return next;
      });
    }
  }

  async function createTransaction(data: Partial<Transaction>) {
    // jsonFetch throws the same `errors ?? body` shape this used to build by hand, and also
    // catches the redirect-to-login case. The modal relies on the throw to show field errors.
    await jsonFetch(`/budgets/${budget_pk}/transactions/create/`, "POST", data);
    router.reload({ only: ["overview", "pending_count"] });
  }

  function renderCategoryRow(cat: BudgetOverviewCategory, isChild = false) {
    const available = parseFloat(cat.available);
    const budgeted = parseFloat(cat.budgeted);
    const assigned = parseFloat(cat.assigned);
    const activity = parseFloat(cat.activity);
    const isExpense = cat.category_type === "expense";

    const budgetedClass = budgeted > 0 && activity > budgeted ? "text-expense" : "";
    const assignedClass = budgeted > 0 && assigned === budgeted ? "text-moss" : "";
    const availableClass = isExpense
      ? available < 0
        ? "text-expense font-semibold"
        : available === 0
          ? "text-muted-foreground"
          : "text-moss"
      : "text-moss";

    return (
      <TableRow key={cat.id}>
        <TableCell style={isChild ? { paddingLeft: "2.25rem" } : undefined}>
          <a
            href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`}
            className="no-underline hover:underline"
          >
            {cat.name}
          </a>
          {cat.rollover && !cat.is_goal && (
            <span className="ml-1.5 inline-flex text-moss" title="Leftover rolls over to next month">
              <RotateCcw aria-hidden className="size-3" />
              <span className="sr-only">Rolls over</span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {cat.rollover && !cat.is_goal ? (
            <span className={`tabular-nums ${budgetedClass}`} title="Auto-budgeted: base + carried-over balance">
              {fmt(cat.budgeted, symbol)}
            </span>
          ) : (
            <CurrencyEditCell
              symbol={symbol}
              value={cat.budgeted}
              editing={editingBudgeted[cat.id]}
              onStart={() => {
                setEditingBudgeted((prev) => ({ ...prev, [cat.id]: cat.budgeted }));
              }}
              onChange={(v) => setEditingBudgeted((prev) => ({ ...prev, [cat.id]: v }))}
              onCommit={() => void saveBudgeted(cat)}
              onCancel={() =>
                setEditingBudgeted((prev) => {
                  const n = { ...prev };
                  delete n[cat.id];
                  return n;
                })
              }
              saving={savingBudgeted[cat.id] ?? false}
              valueClass={budgetedClass}
              title="Click to set monthly target"
            />
          )}
        </TableCell>
        <TableCell className="text-right">
          {cat.rollover && !cat.is_goal ? (
            <span
              className="tabular-nums text-muted-foreground"
              title="Rollover categories aren't assigned from Ready to Assign — the base sets the budget"
            >
              —
            </span>
          ) : (
            <CurrencyEditCell
              symbol={symbol}
              value={cat.assigned}
              editing={editingAssigned[cat.id]}
              onStart={() => {
                setEditingAssigned((prev) => ({ ...prev, [cat.id]: cat.assigned }));
              }}
              onChange={(v) => setEditingAssigned((prev) => ({ ...prev, [cat.id]: v }))}
              onCommit={() => void saveAssigned(cat)}
              onCancel={() =>
                setEditingAssigned((prev) => {
                  const n = { ...prev };
                  delete n[cat.id];
                  return n;
                })
              }
              saving={savingAssigned[cat.id] ?? false}
              valueClass={assignedClass}
              title="Click to set assigned amount"
            />
          )}
        </TableCell>
        <TableCell className="text-right">{fmt(cat.activity, symbol)}</TableCell>
        <TableCell className={`text-right ${availableClass}`}>{fmt(cat.available, symbol)}</TableCell>
      </TableRow>
    );
  }

  const income = overview.categories.filter((c) => c.category_type === "income");
  const expense = overview.categories.filter((c) => c.category_type === "expense" && !c.is_goal);

  function renderHierarchical(cats: BudgetOverviewCategory[]) {
    const roots = cats.filter((c) => c.parent_id === null);
    const childrenByParent = new Map<number, BudgetOverviewCategory[]>();
    for (const c of cats) {
      if (c.parent_id !== null) {
        const list = childrenByParent.get(c.parent_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_id, list);
      }
    }
    return roots.flatMap((root) => [
      renderCategoryRow(root, false),
      ...(childrenByParent.get(root.id) ?? []).map((child) => renderCategoryRow(child, true)),
    ]);
  }

  const sfMonthlySpending = parseFloat(overview.goal_monthly_spending);
  // Monthly Spent is the budget-side flow only: non-SF expense category activity.
  // SF spending is shown on its own line and excluded from Kept, since it draws
  // from previously-saved funds, not this month's budget.
  const totalSpent = expense.reduce((sum, c) => sum + parseFloat(c.activity), 0);
  const sfSaved = parseFloat(overview.saved_to_goals_total);
  const incomeTotal = parseFloat(overview.income_total);
  const netAmount = incomeTotal - totalSpent - sfSaved;
  const netPositive = netAmount >= 0;
  const rta = parseFloat(overview.ready_to_assign);

  return (
    <div className="max-w-[1200px]">
      {/* Page header */}
      <header className="mb-8 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isAtBackLimit(month)}
          onClick={() => navigateMonth(prevMonth(month))}
          aria-label="Previous month"
        >
          <ChevronLeft />
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">{formatMonth(month)}</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigateMonth(nextMonth(month))}
          disabled={isCurrentMonth}
          aria-label="Next month"
        >
          <ChevronRight />
        </Button>
      </header>

      {/* Ready to Assign — this month's income minus what's assigned and saved to goals. */}
      {(incomeTotal > 0 || parseFloat(overview.expense_assigned) > 0) && Math.abs(rta) >= 0.005 && (
        <Alert
          variant={rta >= 0 ? "success" : "destructive"}
          className={isCurrentMonth && pending_count > 0 ? "mb-4" : "mb-8"}
        >
          <AlertDescription>
            <div className="flex justify-between items-center w-full gap-4 flex-wrap">
              <div>
                <strong className="font-semibold">Ready to Assign</strong>
                <div className="text-sm text-muted-foreground">
                  Income {fmt(overview.income_total, symbol)} &minus; Assigned {fmt(overview.expense_assigned, symbol)}
                  {parseFloat(overview.saved_to_goals_total) > 0 && (
                    <> &minus; Saved {fmt(overview.saved_to_goals_total, symbol)}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {fmt(overview.ready_to_assign, symbol)}
                </span>
                {rta > 0 && (
                  <Button size="sm" onClick={() => setAssigning(true)}>
                    Assign
                  </Button>
                )}
                {rta < 0 && (
                  <Button size="sm" onClick={() => setCleaning(true)}>
                    Reduce
                  </Button>
                )}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Pending review */}
      {isCurrentMonth && pending_count > 0 && (
        <Alert className="mb-8 border-fund/30 bg-fund-soft text-ink *:data-[slot=alert-description]:text-ink">
          <AlertDescription>
            <div className="flex justify-between items-center w-full gap-4">
              <div>
                <strong className="font-semibold">
                  {pending_count} transaction{pending_count === 1 ? "" : "s"} awaiting review
                </strong>
                <div className="text-sm text-ink-quiet">Recurring transactions or entries without a paid date.</div>
              </div>
              <Button
                size="sm"
                onClick={() => router.visit(`/budgets/${budget_pk}/transactions/?month=${month}`)}
                className="bg-fund/20 text-ink hover:bg-fund/30 border-fund/40 dark:hover:bg-fund/35"
              >
                Review
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Budget Grid */}
      {overview.categories.length === 0 ? (
        <div className="text-muted-foreground text-center py-16">
          <p className="mb-4">No categories yet.</p>
          <Button asChild variant="outline">
            <a href={`/budgets/${budget_pk}/categories/`}>Add some categories to get started</a>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {income.length > 0 && (
            <div className="md:col-span-4 flex flex-col gap-6">
              {/* Income card — short */}
              <Card className="p-0 gap-0 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-2 bg-moss-soft text-ink">
                  <span className={SECTION_LABEL_CLASS}>Income</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="hover:bg-moss/20 hover:text-ink"
                    onClick={() => setAddTransactionType("income")}
                  >
                    + Add
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Spent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const roots = income.filter((c) => c.parent_id === null);
                      const kids = new Map<number, BudgetOverviewCategory[]>();
                      for (const c of income) {
                        if (c.parent_id !== null) {
                          const list = kids.get(c.parent_id) ?? [];
                          list.push(c);
                          kids.set(c.parent_id, list);
                        }
                      }
                      const renderRow = (cat: BudgetOverviewCategory, isChild: boolean) => (
                        <TableRow key={cat.id}>
                          <TableCell style={isChild ? { paddingLeft: "2.25rem" } : undefined}>
                            <a
                              href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`}
                              className="no-underline hover:underline"
                            >
                              {cat.name}
                            </a>
                          </TableCell>
                          <TableCell className="text-right text-income">{fmt(cat.activity, symbol)}</TableCell>
                        </TableRow>
                      );
                      return roots.flatMap((root) => [
                        renderRow(root, false),
                        ...(kids.get(root.id) ?? []).map((child) => renderRow(child, true)),
                      ]);
                    })()}
                  </TableBody>
                </Table>
              </Card>

              {/* This month summary — single coherent card, plain header */}
              <Card>
                <div className="px-5 py-4 flex flex-col gap-2.5">
                  <span className={`${SECTION_LABEL_CLASS} text-ink-quiet`}>This month</span>
                  <dl className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-baseline">
                      <dt className="text-sm text-ink-quiet">Total Income</dt>
                      <dd className="text-income tabular-nums">{fmt(overview.income_total, symbol)}</dd>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <dt className="text-sm text-ink-quiet">Spent</dt>
                      <dd className="text-expense tabular-nums">{fmt(totalSpent, symbol)}</dd>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <dt className="text-sm text-ink-quiet">Saved to goals</dt>
                      <dd className="text-fund tabular-nums">{fmt(sfSaved, symbol)}</dd>
                    </div>
                    <hr className="border-rule my-1.5" />
                    {sfMonthlySpending > 0 && (
                      <div className="flex justify-between items-baseline">
                        <dt
                          className="text-sm text-ink-quiet"
                          title="Drawn from previously-saved goal balances, not this month's budget"
                        >
                          Paid from goals
                        </dt>
                        <dd className="text-fund tabular-nums">{fmt(sfMonthlySpending, symbol)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between items-baseline">
                      <dt className="text-sm font-medium">Kept</dt>
                      <dd
                        className={`text-xl font-semibold tracking-tight tabular-nums ${netPositive ? "text-moss" : "text-expense"}`}
                      >
                        {netPositive ? "" : "−"}
                        {fmt(Math.abs(netAmount), symbol)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </Card>
            </div>
          )}

          {/* Expenses — primary, full-height column */}
          {expense.length > 0 && (
            <div className="md:col-span-8 flex flex-col gap-6">
              <Card className="p-0 gap-0 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-2 bg-expense-soft text-ink">
                  <span className={SECTION_LABEL_CLASS}>Expenses</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="hover:bg-expense/20 hover:text-ink"
                    onClick={() => setAddTransactionType("expense")}
                  >
                    + Add
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Budgeted</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Spent</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderHierarchical(expense)}</TableBody>
                </Table>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Assign Modal */}
      {assigning && (
        <AssignModal
          budgetPk={budget_pk}
          month={month}
          categories={overview.categories}
          readyToAssign={rta}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            router.reload({ only: ["overview"] });
          }}
        />
      )}

      {/* Cleanup Assigned Modal */}
      {cleaning && (
        <CleanupAssignedModal
          budgetPk={budget_pk}
          month={month}
          categories={overview.categories}
          overAssignedBy={Math.abs(rta)}
          onClose={() => setCleaning(false)}
          onSaved={() => {
            setCleaning(false);
            router.reload({ only: ["overview"] });
          }}
        />
      )}

      {/* Transaction Modal */}
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
    </div>
  );
}
