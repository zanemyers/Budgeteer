import { router } from "@inertiajs/react";
import { ChevronLeft, ChevronRight, Download, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MonthLabel } from "@/components/MonthLabel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { isGoalComplete } from "../utils/goals";
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
      // Assigning money is the reason this page exists, and every one of these was a 19px-tall
      // target — the smallest on the page, and 13px wide on a category with nothing assigned yet.
      // On a coarse pointer it becomes a real 44px target: inline-flex so min-height applies and
      // the figure still aligns inside the row, and negative margin so the wider hit area does not
      // push the column out. Rows getting taller on a phone is the intended outcome.
      className={`${align === "right" ? "text-right touch:justify-end" : "text-left touch:justify-start"} cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 touch:inline-flex touch:min-h-11 touch:min-w-11 touch:items-center touch:-my-2 touch:px-1`}
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
  //
  // Centring was tried twice and abandoned both times: text-center staggers a short label against a
  // long number, and a centred w-fit block breaks the shared left edge the row is read down.
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
  // The category whose row editor is open. Below sm a row opens this instead of editing in place.
  const [rowEditor, setRowEditor] = useState<BudgetOverviewCategory | null>(null);
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

  /**
   * The row editor for phones.
   *
   * Every row carried two targets — a 16px category link beside a 19px amount button — sitting
   * inside 35px of height. That is the same "four tap targets in a space the size of a thumb"
   * problem the register was reworked to remove, so below sm the row becomes one target that opens
   * this, and the figures in the row go read-only. From sm up nothing changes: inline editing is
   * quick with a mouse, and this modal is simply another way in.
   *
   * It writes through the same edit buffers and the same save calls as the inline cells, so there is
   * one persistence path rather than two that can drift.
   */
  function openRowEditor(cat: BudgetOverviewCategory) {
    setEditingAssigned((prev) => ({ ...prev, [cat.id]: cat.assigned }));
    if (!cat.is_goal && !cat.rollover) {
      setEditingBudgeted((prev) => ({ ...prev, [cat.id]: cat.budgeted }));
    }
    setRowEditor(cat);
  }

  /**
   * Opens the row editor, but only for a click on the empty part of a row.
   *
   * The name link, the inline amount cells and their inputs each handle their own click; a
   * row-level handler that fired regardless would open the editor on top of the cell being typed
   * into. One guard here beats a stopPropagation on every control inside.
   */
  function rowClick(cat: BudgetOverviewCategory) {
    return (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("a, button, input")) return;
      openRowEditor(cat);
    };
  }

  function closeRowEditor() {
    if (rowEditor) {
      clearEditAssigned(rowEditor.id);
      clearEditBudgeted(rowEditor.id);
    }
    setRowEditor(null);
  }

  function renderRowEditor() {
    const cat = rowEditor;
    if (!cat) return null;
    const targetEditable = !cat.is_goal && !cat.rollover;
    const monthly = parseFloat(cat.goal_monthly_needed ?? "0");
    const busy = (savingAssigned[cat.id] ?? false) || (savingBudgeted[cat.id] ?? false);

    // An arrow rather than a declaration: a hoisted function loses the null narrowing on `cat`.
    const save = async () => {
      await saveAssigned(cat);
      if (targetEditable) await saveBudgeted(cat);
      setRowEditor(null);
    };

    return (
      <Dialog open onOpenChange={(open) => !open && closeRowEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cat.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <label className="flex flex-col gap-1.5" htmlFor="row-editor-assigned">
              <span className="text-sm font-medium">
                {cat.is_goal ? "Assigned to this goal this month" : "Assigned this month"}
              </span>
              <div className="flex items-center">
                <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 border-input bg-muted px-2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="row-editor-assigned"
                  type="number"
                  className="rounded-l-none"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={editingAssigned[cat.id] ?? cat.assigned}
                  onChange={(e) => setEditingAssigned((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                  disabled={busy}
                />
              </div>
            </label>

            {targetEditable && (
              <label className="flex flex-col gap-1.5" htmlFor="row-editor-target">
                <span className="text-sm font-medium">Monthly target</span>
                <div className="flex items-center">
                  <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 border-input bg-muted px-2 text-sm text-muted-foreground">
                    {symbol}
                  </span>
                  <Input
                    id="row-editor-target"
                    type="number"
                    className="rounded-l-none"
                    min="0"
                    step="0.01"
                    value={editingBudgeted[cat.id] ?? cat.budgeted}
                    onChange={(e) => setEditingBudgeted((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                    disabled={busy}
                  />
                </div>
              </label>
            )}

            {/* The figures this row cannot change, so the modal still answers "where does this
                category stand" without sending you back to the table to read it. */}
            <dl className="flex flex-col gap-1 text-sm">
              {cat.is_goal ? (
                <>
                  {monthly > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Asks for each month</dt>
                      <dd className="tabular-nums">{fmt(String(monthly), symbol)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Saved all time</dt>
                    <dd className="tabular-nums">{fmt(cat.goal_total_saved, symbol)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Spent this month</dt>
                  <dd className="tabular-nums">{fmt(cat.activity, symbol)}</dd>
                </div>
              )}
              {cat.rollover && !cat.is_goal && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Target (base + carried)</dt>
                  <dd className="tabular-nums">{fmt(cat.budgeted, symbol)}</dd>
                </div>
              )}
            </dl>

            <a
              href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}${cat.is_goal ? "&all=1" : ""}`}
              className="text-sm"
            >
              View transactions
            </a>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRowEditor} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /**
   * The assigned figure as plain text, for the phone layout where the row is the control.
   * Matches CurrencyEditCell's own rendering, including the em dash for nothing assigned yet.
   */
  function readOnlyFigure(value: string, className?: string) {
    return parseFloat(value) > 0 ? (
      <span className={className}>{fmt(value, symbol)}</span>
    ) : (
      <span className="italic text-muted-foreground">—</span>
    );
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
      /* The row is the tap target below sm. From sm up the inline controls and the name link stop
         the click, so this only fires on the empty part of a row — where opening the editor is a
         reasonable reading of the click anyway. */
      <TableRow key={cat.id} className="max-sm:cursor-pointer" onClick={rowClick(cat)}>
        <TableCell style={isChild ? { paddingLeft: "2.25rem" } : undefined}>
          <a
            href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`}
            className="hidden sm:inline no-underline hover:underline"
          >
            {cat.name}
          </a>
          {/* The keyboard route into the row editor, and the reason the row does not need to be a
              button itself. The transactions link this replaces lives inside the editor. */}
          <button
            type="button"
            className="sm:hidden text-left rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 touch:inline-flex touch:min-h-11 touch:items-center"
            onClick={() => openRowEditor(cat)}
          >
            {cat.name}
          </button>
          {cat.rollover && !cat.is_goal && (
            <span className="ml-1.5 inline-flex text-moss" title="Leftover rolls over to next month">
              <RotateCcw aria-hidden className="size-3" />
              <span className="sr-only">Rolls over</span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {/* Read-only below sm: the row opens the editor, so a second target in the same row would
              put the old pair of tiny buttons straight back. */}
          <div className="sm:hidden text-sm tabular-nums">
            {readOnlyFigure(cat.assigned, overTarget ? "text-expense" : assignedClass)}
            {showTarget && <span className="text-muted-foreground"> / {fmt(cat.budgeted, symbol)}</span>}
            {overTarget && <span className="block text-xs text-expense">{fmt(String(overBy), symbol)} over</span>}
          </div>
          <div className="hidden sm:flex flex-wrap items-baseline justify-end gap-x-1">
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

  // Goals get their own row shape rather than sharing renderCategoryRow. The target column here is
  // the monthly contribution the goal asks for, which is computed from the target and the time left
  // rather than typed, so it is read-only; and the last column is a lifetime balance, not this
  // month's spend.
  function renderGoalRow(cat: BudgetOverviewCategory) {
    const monthly = parseFloat(cat.goal_monthly_needed ?? "0");
    const assigned = parseFloat(cat.assigned);
    // Same epsilon and same hide-once-met rule as the expense rows, for the same reasons.
    const onTarget = monthly > 0 && Math.abs(assigned - monthly) < 0.005;
    const shortOfMonthly = monthly - assigned > 0.005;

    return (
      <TableRow key={cat.id} className="max-sm:cursor-pointer" onClick={rowClick(cat)}>
        <TableCell>
          {/* `whitespace-normal` on the inner elements, not on the cell: TableCell hard-codes
              md:whitespace-nowrap, and a competing md:whitespace-normal on the same cell would be
              decided by Tailwind's internal property ordering rather than by source order. The cell
              stays nowrap and the name wraps inside it, which is what actually matters — with nowrap
              a single long goal name sets the column's min-content width, and one 50-character name
              was dragging the table 68px past its column even at 1280px. */}
          {/* All time, like the Goals page: the balance beside it is a lifetime figure. */}
          <a
            href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}&all=1`}
            className="hidden sm:inline whitespace-normal no-underline hover:underline"
          >
            {cat.name}
          </a>
          <button
            type="button"
            className="sm:hidden whitespace-normal text-left rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 touch:inline-flex touch:min-h-11 touch:items-center"
            onClick={() => openRowEditor(cat)}
          >
            {cat.name}
          </button>
          {/* The Saved column folds to here for the one band where it can't have a column of its
              own. Same trick the tables use on phones, just at lg because this card lives in the
              narrow sidebar rather than the full width. lg was measurably too early: at 1024px
              the sidebar is ~290px and three figure columns still want ~340px. */}
          <div className="hidden md:block xl:hidden text-xs text-muted-foreground tabular-nums">
            {fmt(cat.goal_total_saved, symbol)} saved
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="sm:hidden text-sm tabular-nums whitespace-nowrap">
            {readOnlyFigure(cat.assigned, onTarget ? "text-moss" : undefined)}
            {shortOfMonthly && <span className="text-muted-foreground"> / {fmt(String(monthly), symbol)}</span>}
          </div>
          {/* No wrap, unlike the expense rows: the assigned figure and the monthly ask read as one
              "50 / 100" pair, and this card sits in the narrow column where they would otherwise
              break across two lines. The table scrolls if a pair ever outgrows the column. */}
          <div className="hidden sm:flex items-baseline justify-end gap-x-1 whitespace-nowrap">
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
              valueClass={onTarget ? "text-moss" : ""}
              title="Click to set what this goal gets this month"
            />
            {shortOfMonthly && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  /
                </span>
                <span
                  className="text-sm tabular-nums text-muted-foreground"
                  title={
                    cat.goal_ongoing
                      ? "What this goal asks for each month"
                      : `What it takes each month to reach ${fmt(cat.goal_target, symbol)}${
                          cat.goal_months_remaining ? ` in ${cat.goal_months_remaining}mo` : ""
                        }`
                  }
                >
                  {fmt(String(monthly), symbol)}
                </span>
              </>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right md:hidden xl:table-cell" title="Balance in this goal, all time">
          {fmt(cat.goal_total_saved, symbol)}
        </TableCell>
      </TableRow>
    );
  }

  const income = overview.categories.filter((c) => c.category_type === "income");
  const expense = overview.categories.filter((c) => c.category_type === "expense" && !c.is_goal);
  // Met goals drop off: this card is about what still needs funding this month.
  const activeGoals = overview.categories.filter((c) => c.is_goal && !isGoalComplete(c));

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
  // Income that hasn't gone out the door, deliberately the difference between the first three
  // boxes on this strip so the four can be checked against each other by eye. Not the same
  // question as `rta`, which is income that hasn't been *assigned* — money can sit assigned but
  // unspent in a category, and then what's assignable is the smaller of the two.
  //
  // Money deposited into a goal has left the month's pool as surely as money spent, so it is
  // subtracted here exactly as `ready_to_assign` subtracts it server-side. The two deposit routes
  // land differently and both need this: a Goals-page deposit is transaction_type "transfer" and
  // touches neither of the other terms, while the modal's "Deposit" writes an income-type line to
  // a goal category, which lands in income_total — so without this it *raised* Remaining. Netting
  // it against saved_to_goals_total leaves that case at zero rather than double-counting it.
  const remaining = parseFloat(overview.income_total) - totalSpent - parseFloat(overview.saved_to_goals_total);

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
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isAtBackLimit(month)}
            onClick={() => navigateMonth(prevMonth(month))}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
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

        {/* The month's whole picture: figures, categories, goals and what was paid out of them.
            A plain link, so the browser handles the download. The flat one-row-per-line sheet for
            importing elsewhere lives on the Transactions page.
            On a phone the label goes and the icon carries it alone: "Export August 2026" set beside
            the month heading was wide enough to wrap the header onto a second line, and it is a
            secondary action that had no business being the widest thing up there. The name survives
            in aria-label and the tooltip, and a coarse pointer still gets a full 44px target. */}
        <Button asChild variant="outline" size="sm" className="ml-auto max-sm:touch:w-11">
          <a
            href={`/budgets/${budget_pk}/export/?month=${month}`}
            download
            aria-label={`Export ${formatMonth(month)}`}
            title={`Export ${formatMonth(month)}`}
          >
            <Download aria-hidden className="size-4" />
            <span className="hidden sm:inline">Export {formatMonth(month)}</span>
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
                    title="Income minus expenses and money saved to goals. Differs from what is assignable when money is assigned but not yet spent."
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
            <a href={`/budgets/${budget_pk}/settings/?tab=categories`}>Add some categories to get started</a>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {(income.length > 0 || activeGoals.length > 0) && (
            <div className="md:col-span-4 flex flex-col gap-6">
              {/* Income card — short */}
              {income.length > 0 && (
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
                              {/* Nothing on an income row is editable, so it keeps its link rather
                                  than gaining a row editor — it just needs a target a thumb can
                                  land on. */}
                              <a
                                href={`/budgets/${budget_pk}/transactions/?month=${month}&category=${cat.id}`}
                                className="no-underline hover:underline touch:inline-flex touch:min-h-11 touch:items-center"
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
              )}

              {activeGoals.length > 0 && (
                <Card className="p-0 gap-0 overflow-hidden">
                  <div className="flex justify-between items-center px-4 py-2 bg-fund-soft text-ink">
                    <span className={SECTION_LABEL_CLASS}>Goals</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="hover:bg-fund/20 hover:text-ink"
                      onClick={() => router.visit(`/budgets/${budget_pk}/goals/`)}
                    >
                      View all
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Goal</TableHead>
                        {/* TableHead only stops wrapping at md, and this card is at its narrowest
                            below that, where the grid is a single column. Held on one line here so
                            the auto layout has to widen the column rather than break the label. */}
                        <TableHead className="text-right whitespace-nowrap">Assigned / mo</TableHead>
                        {/* Hidden md→lg only, in lockstep with its cell. Below md the grid is a
                            single column and there's room; from xl the sidebar is wide enough
                            again. In between it's 224–290px, which three figure columns don't
                            fit — see renderGoalRow for where this figure goes instead. */}
                        <TableHead className="text-right md:hidden xl:table-cell">Saved</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{activeGoals.map((cat) => renderGoalRow(cat))}</TableBody>
                  </Table>
                </Card>
              )}
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
          transaction={null}
          defaultCategoryType={addTransactionType}
          onSave={createTransaction}
          onClose={() => setAddTransactionType(null)}
        />
      )}

      {renderRowEditor()}
    </div>
  );
}
