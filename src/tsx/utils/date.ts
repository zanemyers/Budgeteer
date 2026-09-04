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
 *
 * Takes the first 10 characters because several callers hand this a full datetime
 * from a `DateTimeField().isoformat()` (`balance_as_of`, `created_at`). Appending the
 * suffix to one of those built "…T08:10:00+00:00T00:00:00", which rendered as
 * "Invalid Date". Slicing is a no-op for the date-only strings.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a YYYY-MM month string as "September 2026".
 *
 * Same `T00:00:00` reasoning as `fmtDate` — a bare "2026-09-01" parses as UTC midnight,
 * which is August 31st west of UTC and would name the wrong month.
 */
export function fmtMonth(ym: string): string {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * A run of YYYY-MM month strings around `anchor` (itself a YYYY-MM), from `before` months
 * earlier through `after` months later. Built by walking a Date so year boundaries and
 * month lengths take care of themselves.
 */
export function monthRange(anchor: string, before: number, after: number): string[] {
  const [year, month] = anchor.split("-").map(Number);
  const out: string[] = [];
  for (let offset = -before; offset <= after; offset++) {
    const d = new Date(year, month - 1 + offset, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Format an ISO datetime string (with time component) as a medium-style date + short time.
 * Returns "never" when the input is null/empty — meant for "last synced at" displays.
 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
