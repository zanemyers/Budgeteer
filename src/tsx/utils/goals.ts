import type { BudgetOverviewCategory } from "../types";

/**
 * Whether a goal has been met.
 *
 * The two kinds ask different questions of the ledger. A dated goal's target is a total to cover by
 * a date, so it counts every dollar ever put in and stays met once funded, even after it has been
 * spent back down. An ongoing goal's target is a balance to hold, so it counts what is actually
 * there now and drops below the line again when the goal is drawn on.
 */
export function isGoalComplete(cat: BudgetOverviewCategory): boolean {
  const target = parseFloat(cat.goal_target ?? "0");
  const held = parseFloat(cat.goal_total_saved ?? "0");
  const credited = parseFloat(cat.goal_total_credited ?? "0");
  return cat.goal_ongoing ? held >= target : credited >= target;
}
