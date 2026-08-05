import { router } from "@inertiajs/react";
import { ChevronLeft, ChevronRight, Download, RotateCcw } from "lucide-react";
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
  /** Right for the numeric column; left for the target line under a category name. */
  align?: "left" | "right";
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
  align = "right",
}: CurrencyEditCellProps) {
  const numeric = parseFloat(value);
  if (editing !== undefined) {
    return (
      <div className={align === "right" ? "flex justify-end" : "flex justify-start"}>
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
      className={`${align === "right" ? "text-right" : "text-left"} cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2`}
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

/**
 * One figure in the month's summary strip.
 *
 * The four share a single card divided by rules rather than sitting in four separate cards, because
 * four cards in a grid become four full-width blocks stacked down a phone — a screen and a half of
 * scrolling before the budget itself. Ruled cells wrap two-by-two instead.
 *
 * `index` drives which edges get a rule: on a narrow screen the second of each pair takes a left
 * rule and the bottom pair takes a top one; from `sm` up they sit in a single row, so every cell but
 * the first takes a left rule and none take a top one. Tailwind's `divide-x` cannot express that,
 * since it would draw a rule at the start of a wrapped row.
 *
 * `accent` still marks the cell that carries an action rather than just a number, now as a tint on
 * the cell instead of a band above it.
 */
function SummaryCell({
  label,
  index,
  accent,
  children,
}: {
  label: string;
  index: number;
  accent?: "moss" | "alarm";
  children: React.ReactNode;
}) {
  const tint = accent === "moss" ? "bg-moss-soft/40" : accent === "alarm" ? "bg-expense-soft/40" : "";

  // Rules are inset elements rather than cell borders. A border runs the full edge and so meets the
  // card's own outline at both ends, which reads as the card being cut into pieces; these stop short
  // and read as a separator between figures.
  //
  // Which ones show still depends on the wrap. The left rule always belongs to the second of a pair,
  // so cells 1 and 3 keep it at every width; cell 2 only earns one once the four sit in a single row.
  // The top rule is the mobile-only divider between the two rows.
  const leftRule = index === 0 ? null : index === 2 ? "hidden sm:block" : "block";
  const topRule = index >= 2 ? "sm:hidden" : null;

  // Left-aligned, but given room. At px-4 the figures sat hard against the rule beside them, which
  // read as crowded rather than as a column; the extra padding lets each one breathe without moving
  // the numbers off the shared left edge that makes them scannable down the row.
  return (
    <div className={`relative px-5 py-4 sm:px-6 ${tint}`}>
      {leftRule && <span aria-hidden className={`absolute inset-y-3 left-0 w-px bg-border ${leftRule}`} />}
      {topRule && <span aria-hidden className={`absolute inset-x-5 top-0 h-px bg-border sm:inset-x-6 ${topRule}`} />}
      <span className={`${SECTION_LABEL_CLASS} ${accent ? "text-ink" : "text-ink-quiet"}`}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
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
    const budgeted = parseFloat(cat.budgeted);
    const assigned = parseFloat(cat.assigned);
    // A carried balance pre-fills `assigned` without being charged to Ready to Assign, so it's
    // worth explaining wherever that figure appears.
    const carried = cat.rollover_carry !== null && parseFloat(cat.rollover_carry) > 0;

    // Epsilon rather than `===` because both sides come from parseFloat over serialized decimals.
    const onTarget = Math.abs(assigned - budgeted) < 0.005;
    // Guarded on a target existing: without it, any assignment to a category with no target read
    // as "over", which is a comparison against nothing — and now that the target is hidden once
    // met, there would be no visible figure to explain the red.
    const overTarget = budgeted > 0 && assigned - budgeted > 0.005;
    const overBy = assigned - budgeted;
    // The target is a reference for a row still working toward one. Once assigned has reached or
    // passed it, restating it is clutter — the colour says it was met, and the overage says by how
    // much it was passed.
    const showTarget = budgeted - assigned > 0.005;
    // Reuses the epsilon: an exact === on parseFloat results missed rows that were on target by
    // any floating-point residue.
    const assignedClass = budgeted > 0 && onTarget ? "text-moss" : "";

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
          <div className="flex flex-wrap items-baseline justify-end gap-x-1">
            <CurrencyEditCell
              symbol={symbol}
              value={cat.assigned}
              editing={editingAssigned[cat.id]}
              onStart={() => {
                setEditingAssigned((prev) => ({ ...prev, [cat.id]: cat.assigned }));
              }}
              onChange={(v) => setEditingAssigned((prev) => ({ ...prev, [cat.id]: v }))}
              onCommit={() => void saveAssigned(cat)}
              onCancel={() => clearEditAssigned(cat.id)}
              saving={savingAssigned[cat.id] ?? false}
              valueClass={overTarget ? "text-expense" : assignedClass}
              title={
                carried
                  ? `${fmt(cat.rollover_carry, symbol)} carried over from last month. Reduce this to move it elsewhere.`
                  : "Click to set assigned amount"
              }
            />
            {showTarget && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  /
                </span>
                {/* A rollover category's target is base + carried balance, computed rather than
                    typed, so it is read-only here and explained on hover. */}
                {cat.rollover && !cat.is_goal ? (
                  <span
                    className="text-sm tabular-nums text-muted-foreground"
                    title={
                      carried
                        ? `${fmt(cat.base_amount, symbol)} base + ${fmt(cat.rollover_carry, symbol)} carried over`
                        : "Target for this month (base amount)"
                    }
                  >
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
                    onCancel={() => clearEditBudgeted(cat.id)}
                    saving={savingBudgeted[cat.id] ?? false}
                    valueClass="text-sm tabular-nums text-muted-foreground"
                    title="Click to set monthly target"
                  />
                )}
              </>
            )}
            {overTarget && (
              <span className="whitespace-nowrap text-xs text-expense">
                &middot; {fmt(String(overBy), symbol)} over
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">{fmt(cat.activity, symbol)}</TableCell>
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
  // The budget-side flow only: non-goal expense category activity. Goal spending is shown on its
  // own line and excluded here, since it draws from previously-saved funds rather than this
  // month's budget. This is the figure Remaining is measured against.
  const totalSpent = expense.reduce((sum, c) => sum + parseFloat(c.activity), 0);
  const rta = parseFloat(overview.ready_to_assign);
  // Income that hasn't gone out the door, deliberately the difference between the first two
  // boxes on this strip so the three can be checked against each other by eye. Not the same
  // question as `rta`, which is income that hasn't been *assigned* — money can sit assigned but
  // unspent in a category, and then what's assignable is the smaller of the two.
  const remaining = parseFloat(overview.income_total) - totalSpent;

  // The fourth box changes character with the month. While there is money to assign it is the
  // place you assign it; once there isn't, leading with a 0.00 said nothing, so it becomes a
  // plain readout of what is left. Over-assignment outranks the empty case so a budget with no
  // income but money already assigned still shows the problem rather than a welcome message.
  const overAssigned = rta < -0.005;
  const hasToAssign = rta > 0.005;
  const noIncomeYet = !overAssigned && Math.abs(parseFloat(overview.income_total)) < 0.005;
  const headline = hasToAssign || overAssigned ? parseFloat(overview.ready_to_assign) : remaining;
  // Suppressed at zero as well as when equal: "0.00 remaining" under a figure it already
  // contradicts or restates is noise either way.
  const showRemainingLine = Math.abs(remaining - rta) >= 0.005 && Math.abs(remaining) >= 0.005;

  return (
    <div className="max-w-[1200px]">
      {/* Page header */}
      <header className="mb-8 flex flex-wrap items-center gap-3">
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

        {/* The month's whole picture: figures, categories, goals and what was paid out of them.
            A plain link, so the browser handles the download. The flat one-row-per-line sheet for
            importing elsewhere lives on the Transactions page. */}
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={`/budgets/${budget_pk}/export/?month=${month}`} download>
            <Download aria-hidden className="size-4" />
            Export {formatMonth(month)}
          </a>
        </Button>
      </header>

      {/* Pending review */}
      {isCurrentMonth && pending_count > 0 && (
        <Alert className="mb-4 border-fund/30 bg-fund-soft text-ink *:data-[slot=alert-description]:text-ink">
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

      {/* This month at a glance. Previously a card in the income column — which meant a budget
          with no income categories rendered no summary at all — plus a separate Ready to Assign
          alert saying the same thing twice. */}
      <Card className="mb-8 overflow-hidden p-0">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <SummaryCell label="Total income" index={0}>
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-income">
              {fmt(overview.income_total, symbol)}
            </span>
          </SummaryCell>

          <SummaryCell label="Total expenses" index={1}>
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-expense">
              {fmt(totalSpent, symbol)}
            </span>
          </SummaryCell>

          {/* Number first, then its word — the same shape as the other three, and as the fourth box's
            secondary line. This one used to sit its labels on the left with the figures right-aligned
            against them, which read as a different kind of card in a row of four and put its numbers
            nowhere near the others' eye line. */}
          <SummaryCell label="Goals" index={2}>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight tabular-nums text-fund">
                {fmt(overview.saved_to_goals_total, symbol)}
              </span>
              <span className="text-xs text-ink-quiet">saved</span>
            </div>
            {sfMonthlySpending > 0.005 && (
              <p
                className="mt-1 text-sm text-ink-quiet"
                title="Drawn from previously-saved balances, not this month's budget"
              >
                <span className="tabular-nums text-ink">{fmt(sfMonthlySpending, symbol)}</span> spent from goals
              </p>
            )}
          </SummaryCell>

          {/* The band follows the button: SummaryBox documents `accent` as marking the box that
            carries an action, and it used to be applied unconditionally, emphasising this one even
            in the states where it offers nothing to do. */}
          <SummaryCell
            label={overAssigned ? "Over-assigned" : hasToAssign ? "To assign" : "Remaining"}
            index={3}
            accent={overAssigned ? "alarm" : hasToAssign || noIncomeYet ? "moss" : undefined}
          >
            {noIncomeYet ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink-quiet">No income recorded yet.</p>
                <Button size="sm" variant="outline" onClick={() => setAddTransactionType("income")}>
                  Add income
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`text-2xl font-semibold tracking-tight tabular-nums ${
                      headline < -0.005 ? "text-expense" : "text-moss"
                    }`}
                  >
                    {fmt(headline, symbol)}
                  </span>
                  {hasToAssign && (
                    <Button size="sm" onClick={() => setAssigning(true)}>
                      Assign
                    </Button>
                  )}
                  {overAssigned && (
                    <Button size="sm" variant="destructive" onClick={() => setCleaning(true)}>
                      Reduce
                    </Button>
                  )}
                </div>
                {/* Only when the headline is the assignable figure and what's left after spending
                  is a different, non-zero number. In the Remaining state the headline already is
                  that figure, so the box is a label and a number like the other three. */}
                {(hasToAssign || overAssigned) && showRemainingLine && (
                  <p
                    className="mt-1 text-sm text-ink-quiet"
                    title="Income minus expenses. Differs from what is assignable when money is assigned but not yet spent."
                  >
                    <span className="tabular-nums text-ink">{fmt(remaining, symbol)}</span> remaining
                  </p>
                )}
              </>
            )}
          </SummaryCell>
        </div>
      </Card>

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
                      <TableHead className="text-right">Assigned / target</TableHead>
                      <TableHead className="text-right">Spent</TableHead>
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
