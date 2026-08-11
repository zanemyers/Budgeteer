/**
 * Shared month helpers. Month strings are ISO `"YYYY-MM"` throughout the app.
 */

export const BACK_LIMIT_MONTHS = 2;

export function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 1) return `${year - 1}-12`;
  return `${year}-${String(mon - 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (mon === 12) return `${year + 1}-01`;
  return `${year}-${String(mon + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

/**
 * Only the months long enough to be worth shortening. March through July are absent on purpose —
 * "Jun" saves one character off "June" and reads like a typo rather than an abbreviation. This is
 * the AP convention, and it means the longest label here is "March 2026" rather than "September 2026".
 */
const ABBREVIATED_MONTHS: Record<number, string> = {
  1: "Jan",
  2: "Feb",
  8: "Aug",
  9: "Sept",
  10: "Oct",
  11: "Nov",
  12: "Dec",
};

/**
 * The month label for phone width, where the full name has to share a line with the month arrows and
 * the page's own actions. Falls back to the full name for the months that are already short.
 */
export function formatMonthShort(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const abbreviated = ABBREVIATED_MONTHS[mon];
  return abbreviated ? `${abbreviated} ${year}` : formatMonth(month);
}

export function monthOrdinal(m: string): number {
  const [y, mo] = m.split("-").map(Number);
  return y * 12 + (mo - 1);
}

/** Whether the user can navigate further back from the given month. Chevron back-limit. */
export function isAtBackLimit(month: string): boolean {
  return monthOrdinal(getDefaultMonth()) - monthOrdinal(month) >= BACK_LIMIT_MONTHS;
}
