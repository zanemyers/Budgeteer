/**
 * Format an ISO date string (YYYY-MM-DD) as a short, locale-aware date.
 * Returns "—" when the input is null/empty.
 *
 * Note the `T00:00:00` suffix forces the date to be interpreted in local time
 * so a date string of "2026-06-17" renders as June 17 regardless of timezone.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format an ISO datetime string (with time component) as a medium-style date + short time.
 * Returns "never" when the input is null/empty — meant for "last synced at" displays.
 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
