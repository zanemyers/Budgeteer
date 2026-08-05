/**
 * Today's date as YYYY-MM-DD in the *browser's* timezone.
 *
 * Not `toISOString()`, which is UTC: west of UTC that returns tomorrow's date all
 * evening, so a transaction logged at night would be dated to the following day
 * (and near a month boundary, into the next budget month).
 */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Format an ISO date string (YYYY-MM-DD) as a short, locale-aware date.
 * Returns "—" when the input is null/empty.
 *
 * Note the `T00:00:00` suffix forces the date to be interpreted in local time
 * so a date string of "2026-06-17" renders as June 17 regardless of timezone.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format an ISO datetime string (with time component) as a medium-style date + short time.
 * Returns "never" when the input is null/empty — meant for "last synced at" displays.
 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
