import { formatMonth, formatMonthShort } from "@/utils/month";

/**
 * The month in a page's month navigation. Abbreviates below sm, where the full name, the two arrows
 * and the page's own actions cannot share one line — "September 2026" alone is about 36px wider than
 * "August 2026", enough to wrap a header that fit every other month.
 *
 * Two spans rather than a width hook: CSS cannot swap text, and picking the label in JS would make
 * the first paint depend on the viewport.
 */
export function MonthLabel({ month }: { month: string }) {
  return (
    <>
      <span className="sm:hidden">{formatMonthShort(month)}</span>
      <span className="hidden sm:inline">{formatMonth(month)}</span>
    </>
  );
}
