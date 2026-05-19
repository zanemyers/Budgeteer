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

export function monthOrdinal(m: string): number {
  const [y, mo] = m.split("-").map(Number);
  return y * 12 + (mo - 1);
}

/** Whether the user can navigate further back from the given month. Chevron back-limit. */
export function isAtBackLimit(month: string): boolean {
  return monthOrdinal(getDefaultMonth()) - monthOrdinal(month) >= BACK_LIMIT_MONTHS;
}
