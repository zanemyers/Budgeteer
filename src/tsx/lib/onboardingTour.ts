import { router } from "@inertiajs/react";
// Type-only, so it is erased at build time and pulls nothing into the bundle. The library and its
// stylesheet are loaded on demand in `runStage` — see the note there.
import type { DriveStep } from "driver.js";
import { useEffect, useRef } from "react";
import { getCsrfToken } from "./api";

/**
 * Product tours. Each "stage" is a focused set of driver.js steps for one page. Tours run in two
 * modes: a single page tour (launched from that page), or a chained "full run" that walks every
 * stage in order, auto-navigating between pages and resuming after each Inertia load.
 *
 * Steps target `data-tour` anchors; any step whose anchor is absent on the current page is skipped.
 * A step may instead resolve its anchor at runtime with a function, which is how the settings tab
 * steps cope with the tab strip becoming a single select below md.
 */

export type TourStage = "dashboard" | "transactions" | "goals" | "settings" | "account";

const STAGE_ORDER: TourStage[] = ["dashboard", "transactions", "goals", "settings", "account"];

/**
 * Dispatched when the tour highlights a settings tab, with the tab value as `detail`.
 * BudgetSettings listens and switches the active tab (Radix's controlled value won't respond to a
 * synthetic click, so we drive its own state setter instead).
 */
export const SELECT_TAB_EVENT = "budgeteer:select-settings-tab";

/**
 * Is this element actually on screen?
 *
 * `runStage` drops steps whose anchor is missing, but presence in the DOM was the wrong test for the
 * sidebar: below lg it is a closed drawer held off-screen with `visibility: hidden`, so every
 * sidebar-anchored step survived the filter and driver.js dutifully highlighted something the user
 * could not see. On a phone — the primary target — that was the *first* thing a new account saw,
 * since the full run auto-starts on the dashboard.
 *
 * `visibility` inherits, so reading it off the element covers an ancestor having hidden it, and a
 * zero-size rect covers `display: none`.
 */
function isVisible(el: Element): boolean {
  if (getComputedStyle(el).visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * A step anchored to the sidebar, falling back to the mobile header's menu button.
 *
 * Below lg the sidebar is a drawer, so the thing to point at is what opens it. Copy has to read
 * correctly against either anchor, since driver.js popovers are fixed per step.
 */
function navStep(title: string, description: string): DriveStep {
  return {
    element: () => {
      const sidebar = document.querySelector('[data-tour="account"]');
      if (sidebar && isVisible(sidebar)) return sidebar as Element;
      return document.querySelector('[data-tour="nav-menu"]') as Element;
    },
    popover: { title, description },
  };
}

/**
 * A settings step anchored to a tab; the highlight handler switches to it.
 *
 * Below md the five tabs collapse into one native select, so the per-tab anchors do not exist there.
 * The step falls back to the select, because `runStage` drops any step whose anchor is missing — which
 * otherwise left the settings tour one step long on a phone. Each step dispatches its own tab rather
 * than letting the global hook read it back off the element: the fallback element is shared by all
 * five and so cannot say which tab it stands for.
 */
function tabStep(tab: string, title: string, description: string): DriveStep {
  return {
    element: () =>
      (document.querySelector(`[data-tour="tab-${tab}"]`) ??
        document.querySelector('[data-tour="settings-tabs"]')) as Element,
    popover: { title, description },
    onHighlightStarted: () => {
      window.dispatchEvent(new CustomEvent(SELECT_TAB_EVENT, { detail: tab }));
    },
  };
}

const TOURS: Record<TourStage, DriveStep[]> = {
  dashboard: [
    {
      popover: {
        title: "Welcome to Budgeteer",
        description: "A quick tour of where things live and how each page works. You can exit any time.",
      },
    },
    navStep("Your budgets", "Switch between budgets, or create a new one, from the navigation menu."),
    {
      // Sidebar-only, and dropped below lg by the visibility filter rather than pointing at a drawer
      // that isn't open. The dashboard is already on screen there, so nothing is lost by skipping it.
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
        title: "Pending, logged, ignored",
        description: "Switch between what is scheduled, what has cleared, and items you have set aside.",
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
    tabStep(
      "budget",
      "Budget",
      "Rename this budget, make it your default, and invite a partner or household member. Deleting the budget lives here too.",
    ),
    tabStep(
      "categories",
      "Categories",
      "Where income is recorded, and the spending envelopes it gets assigned to. Group them and set a monthly target for each.",
    ),
    tabStep(
      "pay-schedule",
      "Pay schedule",
      "Describe how you are paid so income lands in the right month and matches automatically.",
    ),
    tabStep(
      "recurring",
      "Recurring transactions",
      "Bills and subscriptions that repeat. Budgeteer schedules them for you.",
    ),
    tabStep("payment-methods", "Payment methods", "The accounts and cards you spend from."),
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
const clearFullRun = () => {
  sessionStorage.removeItem(FLAG);
  sessionStorage.removeItem(SEEN);
};

// Stages already shown during this run. A reload does not run the unmount cleanup, so without this a
// stranded flag re-armed the same stage's overlay on every load of that page — and an overlay you did
// not ask for that eats every click is indistinguishable from the page being broken.
const SEEN = "bt_tour_seen";
const seenStages = (): string[] => JSON.parse(sessionStorage.getItem(SEEN) ?? "[]");
const markStageSeen = (stage: TourStage) => {
  const seen = new Set(seenStages());
  seen.add(stage);
  sessionStorage.setItem(SEEN, JSON.stringify([...seen]));
};

function markOnboarded() {
  // Silent by design: if this fails the tour simply offers itself again, which is a far
  // better outcome than an error toast. The catch is here to avoid an unhandled rejection.
  void fetch("/onboarding/", {
    method: "POST",
    headers: { "X-CSRFToken": getCsrfToken(), "X-Requested-With": "XMLHttpRequest" },
  }).catch(() => {});
}

/**
 * The tour currently on screen, so leaving the page can tear it down.
 *
 * driver.js paints a full-page SVG overlay with a cutout around the highlighted element, and that
 * overlay swallows every pointer event outside the cutout. An overlay left behind therefore makes the
 * page look fine and respond to nothing — which is exactly what happened: navigating away or
 * reloading mid-tour never destroyed the driver, so onDestroyed never ran, so the sessionStorage flag
 * stayed set and every page for the rest of the browser session re-armed a tour whose overlay blocked
 * anything it was not pointing at.
 */
let activeTour: { destroy: () => void } | null = null;

/**
 * Bumped by every `endActiveTour`, so a `runStage` still awaiting its dynamic import can tell that
 * the page it was starting for has since unmounted. Without it, leaving a page during those few
 * milliseconds would raise an overlay over the *next* page with nothing left to tear it down —
 * the same stranded-overlay failure the `activeTour` handle above exists to prevent.
 */
let runToken = 0;

/** Tear down whatever tour is showing. Called when a page unmounts. */
export function endActiveTour() {
  runToken += 1;
  activeTour?.destroy();
  activeTour = null;
}

/**
 * Run one stage's tour. In full mode, advances to the next stage on completion.
 *
 * driver.js and its stylesheet are imported here rather than at module scope: they are ~25 KB of
 * JavaScript plus a stylesheet that only matter once a tour actually runs, and AppLayout imports
 * this module on every page for the "Replay tour" menu item — so a static import put the whole
 * library in the shared entry chunk that even the logged-out landing page downloads.
 *
 * main.css's `.driver-popover.budgeteer-tour` overrides are more specific than driver.css's own
 * rules, so they still win no matter which stylesheet the browser applies last.
 */
async function runStage(stage: TourStage, opts: { full: boolean }) {
  const token = runToken;
  const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);
  // Unmounted while the import was in flight — drop it rather than stranding an overlay.
  if (token !== runToken) return;
  const steps = TOURS[stage].filter((s) => {
    if (!s.element) return true;
    // Steps may resolve their anchor at runtime (see tabStep/navStep), so call it rather than
    // treating the function itself as a selector — querySelector would throw on it.
    const el = typeof s.element === "function" ? s.element() : document.querySelector(s.element as string);
    // Visible, not merely present: the off-screen sidebar drawer is still in the DOM below lg.
    return Boolean(el) && isVisible(el as Element);
  });
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
      activeTour = null;
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
  activeTour = d;
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
    if (seenStages().includes(stage)) return;
    const timer = setTimeout(() => {
      if (ran.current) return;
      ran.current = true;
      markStageSeen(stage);
      // Pages that know their budget refresh the flag, so a run started without one is corrected.
      if (budgetPk != null) setFullRun(budgetPk);
      // Fire and forget: the cleanup below bumps the run token, which the loader checks.
      void runStage(stage, { full: true });
    }, 400);
    // Leaving the page ends the tour rather than abandoning its overlay. Without this, an overlay
    // outlived the page that raised it and silently ate every click on the next one.
    return () => {
      clearTimeout(timer);
      endActiveTour();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, budgetPk, opts?.firstRun]);
}

/** Launch a single page's tour on demand (no navigation, no completion side effects). */
export function startPageTour(stage: TourStage) {
  void runStage(stage, { full: false });
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
    void runStage("dashboard", { full: true });
  } else {
    router.visit(stageUrl("dashboard", budgetPk));
  }
}
