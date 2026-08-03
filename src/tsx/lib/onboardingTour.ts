import { router } from "@inertiajs/react";
import { type DriveStep, driver } from "driver.js";
import { useEffect, useRef } from "react";
import "driver.js/dist/driver.css";
import { getCsrfToken } from "./api";

/**
 * Product tours. Each "stage" is a focused set of driver.js steps for one page. Tours run in two
 * modes: a single page tour (launched from that page), or a chained "full run" that walks every
 * stage in order, auto-navigating between pages and resuming after each Inertia load.
 *
 * Steps target `data-tour` anchors; any step whose anchor is absent on the current page is skipped.
 */

export type TourStage = "dashboard" | "transactions" | "goals" | "settings" | "account";

const STAGE_ORDER: TourStage[] = ["dashboard", "transactions", "goals", "settings", "account"];

/**
 * Dispatched when the tour highlights a settings tab, with the tab value as `detail`.
 * BudgetSettings listens and switches the active tab (Radix's controlled value won't respond to a
 * synthetic click, so we drive its own state setter instead).
 */
export const SELECT_TAB_EVENT = "budgeteer:select-settings-tab";

/** A settings step anchored to a tab; the highlight handler below switches to it. */
function tabStep(tab: string, title: string, description: string): DriveStep {
  return { element: `[data-tour="tab-${tab}"]`, popover: { title, description } };
}

const TOURS: Record<TourStage, DriveStep[]> = {
  dashboard: [
    {
      popover: {
        title: "Welcome to Budgeteer",
        description: "A quick tour of where things live and how each page works. You can exit any time.",
      },
    },
    {
      element: '[data-tour="budget"]',
      popover: { title: "Your budget", description: "Switch between budgets or create a new one here." },
    },
    {
      element: '[data-tour="dashboard"]',
      popover: {
        title: "Dashboard",
        description: "Your home base: what you have earned, spent, and have left to budget this month.",
      },
    },
  ],
  transactions: [
    {
      element: '[data-tour="txn-add"]',
      popover: {
        title: "Add a transaction",
        description: "Log income or an expense. Split it across categories if you need to.",
      },
    },
    {
      element: '[data-tour="txn-tabs"]',
      popover: {
        title: "Pending, logged, transfers, ignored",
        description: "Switch between what is scheduled, what has cleared, transfers, and items you have set aside.",
      },
    },
    {
      element: '[data-tour="month-nav"]',
      popover: {
        title: "Move between months",
        description: "Step back and forward to review or plan a different month.",
      },
    },
  ],
  goals: [
    {
      element: '[data-tour="goal-add"]',
      popover: {
        title: "Create a goal",
        description: "Save toward a target by a date, or set an ongoing monthly amount. Budgeteer does the math.",
      },
    },
    {
      element: '[data-tour="goal-card"]',
      popover: {
        title: "Fund a goal",
        description: "Add a deposit or record spending against a goal right from its card.",
      },
    },
  ],
  settings: [
    {
      element: '[data-tour="settings-tabs"]',
      popover: {
        title: "Everything for this budget",
        description: "Each tab configures one part of the budget. Here is a look at each.",
      },
    },
    tabStep("budget", "Budget", "Rename this budget, make it your default, or delete it."),
    tabStep(
      "pay-schedule",
      "Pay schedule",
      "Describe how you are paid so income lands in the right month and matches automatically.",
    ),
    tabStep("expense", "Expense categories", "Your spending envelopes. Group them and set a monthly target for each."),
    tabStep("income", "Income categories", "Where paychecks and other income are recorded."),
    tabStep("payment-methods", "Payment methods", "The accounts and cards you spend from."),
    tabStep(
      "recurring",
      "Recurring transactions",
      "Bills and subscriptions that repeat. Budgeteer schedules them for you.",
    ),
    tabStep("members", "Members", "Invite a partner or household member and choose who can manage the budget."),
  ],
  account: [
    {
      element: '[data-tour="account-bank"]',
      popover: {
        title: "Connect your bank",
        description: "Link a SimpleFIN bridge to pull live balances and recent transactions into your budget.",
      },
    },
    {
      element: '[data-tour="account-currency"]',
      popover: {
        title: "Your currency",
        description: "Everything displays in this currency; foreign entries convert at the daily rate.",
      },
    },
  ],
};

function stageUrl(stage: TourStage, budgetPk: number): string {
  switch (stage) {
    case "transactions":
      return `/budgets/${budgetPk}/transactions/`;
    case "goals":
      return `/budgets/${budgetPk}/goals/`;
    case "settings":
      return `/budgets/${budgetPk}/settings/`;
    case "account":
      return "/accounts/settings/";
    default:
      return `/budgets/${budgetPk}/`;
  }
}

// Full-run state persists across Inertia page loads in sessionStorage.
const FLAG = "bt_full_tour";
const isFullRun = () => sessionStorage.getItem(FLAG) !== null;
const fullRunBudget = () => Number(sessionStorage.getItem(FLAG));
const setFullRun = (budgetPk: number) => sessionStorage.setItem(FLAG, String(budgetPk));
const clearFullRun = () => sessionStorage.removeItem(FLAG);

function markOnboarded() {
  void fetch("/onboarding/", {
    method: "POST",
    headers: { "X-CSRFToken": getCsrfToken(), "X-Requested-With": "XMLHttpRequest" },
  });
}

/** Run one stage's tour. In full mode, advances to the next stage on completion. */
function runStage(stage: TourStage, opts: { full: boolean }) {
  const steps = TOURS[stage].filter((s) => !s.element || document.querySelector(s.element as string));
  if (steps.length === 0) {
    if (opts.full) advance(stage);
    return;
  }

  let completed = false;
  let settled = false;
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayColor: "var(--ink)",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "budgeteer-tour",
    steps,
    onHighlightStarted: (el) => {
      // Switching to a settings tab as it is highlighted so its content is visible.
      const tour = el instanceof HTMLElement ? el.getAttribute("data-tour") : null;
      if (tour?.startsWith("tab-")) {
        window.dispatchEvent(new CustomEvent(SELECT_TAB_EVENT, { detail: tour.slice(4) }));
      }
    },
    onNextClick: () => {
      if (d.isLastStep()) {
        completed = true;
        d.destroy();
      } else {
        d.moveNext();
      }
    },
    onPrevClick: () => d.movePrevious(),
    onDestroyed: () => {
      if (settled) return;
      settled = true;
      if (!opts.full) return;
      if (completed) advance(stage);
      // Exited early — stop the full run but don't nag again.
      else {
        clearFullRun();
        markOnboarded();
      }
    },
  });
  d.drive();
}

/** Move the full run to the next stage (reading the budget from the flag), or finish it. */
function advance(stage: TourStage) {
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1];
  if (next) {
    router.visit(stageUrl(next, fullRunBudget()));
  } else {
    clearFullRun();
    markOnboarded();
  }
}

/**
 * Run/resume a page's tour during a full run. Call from each page with its own stage.
 * - `firstRun` seeds the full run (first login) so it begins here and chains onward.
 * - Otherwise it resumes an in-progress full run when this page is the current stage.
 * `budgetPk` is only needed to seed the run (dashboard); later stages read it from the flag.
 */
export function usePageTour(stage: TourStage, budgetPk?: number, opts?: { firstRun?: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    if (opts?.firstRun && budgetPk != null && !isFullRun()) setFullRun(budgetPk);
    if (!isFullRun() || ran.current) return;
    // Let the page (and sidebar) paint before anchoring popovers.
    const timer = setTimeout(() => {
      if (ran.current) return;
      ran.current = true;
      // Pages that know their budget refresh the flag, so a run started without one is corrected.
      if (budgetPk != null) setFullRun(budgetPk);
      runStage(stage, { full: true });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, budgetPk, opts?.firstRun]);
}

/** Launch a single page's tour on demand (no navigation, no completion side effects). */
export function startPageTour(stage: TourStage) {
  runStage(stage, { full: false });
}

/** Start the chained full walkthrough from the dashboard. Used by first-run and "Replay tour". */
export function startFullTour(budgetPk?: number) {
  if (budgetPk == null) {
    // No budget in context — route through the home redirect; the dashboard fixes the flag.
    setFullRun(0);
    router.visit("/");
    return;
  }
  setFullRun(budgetPk);
  if (window.location.pathname === stageUrl("dashboard", budgetPk)) {
    runStage("dashboard", { full: true });
  } else {
    router.visit(stageUrl("dashboard", budgetPk));
  }
}
