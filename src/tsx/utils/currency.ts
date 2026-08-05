import { usePage } from "@inertiajs/react";

interface PageProps {
  auth?: { user?: { currency_symbol?: string; currency_code?: string; currency_rate?: string } };
  // Inertia's usePage generic requires an index signature; page props are an open bag.
  [key: string]: unknown;
}

export function useCurrencySymbol(): string {
  const { props } = usePage<PageProps>();
  return props.auth?.user?.currency_symbol ?? "$";
}

export function useCurrencyCode(): string {
  const { props } = usePage<PageProps>();
  return props.auth?.user?.currency_code ?? "USD";
}

export function useCurrencyRate(): string {
  const { props } = usePage<PageProps>();
  return props.auth?.user?.currency_rate ?? "1";
}

/**
 * Money formatting for the whole app.
 *
 * There were four implementations before this: these helpers with bare toFixed(2) and no
 * thousands separators, a local copy in Investments that grouped but signed with a hyphen, and
 * one in Banking using Intl currency style. So the same amount rendered as $12345.60 on the
 * dashboard and $12,345.60 on the investments page.
 *
 * DESIGN.md's numeric conventions drive the rules: grouped thousands, decimals always present,
 * the symbol against the digits with no space, and a true minus sign (U+2212) rather than a
 * hyphen for negatives.
 */
const MONEY = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MINUS = "\u2212";

/** Parse a serialized decimal, returning null for the cases that should render as "—". */
function parseAmount(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : Number.parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

/** `$1,234.56`, or `−$1,234.56` when negative. "—" when there's no value. */
export function fmt(val: string | number | null | undefined, symbol = "$"): string {
  const n = parseAmount(val);
  if (n === null) return "—";
  return `${n < 0 ? MINUS : ""}${symbol}${MONEY.format(Math.abs(n))}`;
}

/** Always carries an explicit sign, for deltas where direction is the point. */
export function fmtSigned(val: string | number | null | undefined, symbol = "$"): string {
  const n = parseAmount(val);
  if (n === null) return "—";
  return `${n < 0 ? MINUS : "+"}${symbol}${MONEY.format(Math.abs(n))}`;
}

/** Convert between two stored rates, then format. */
export function fmtConverted(
  amount: string | number | null | undefined,
  txnRate: string | number,
  userRate: string | number,
  symbol = "$",
): string {
  const n = parseAmount(amount);
  if (n === null) return "—";
  const from = Number.parseFloat(String(txnRate)) || 1;
  const to = Number.parseFloat(String(userRate)) || 1;
  return fmt(n * (to / from), symbol);
}

/**
 * Format in an explicit ISO currency, for values that aren't in the user's own currency —
 * a bank account reports its own, which may differ from the budget's.
 */
export function fmtInCurrency(val: string | number | null | undefined, code: string): string {
  const n = parseAmount(val);
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // An unrecognised code makes Intl throw rather than degrade.
    return `${MONEY.format(n)} ${code}`;
  }
}

/** Share counts and other non-money quantities: grouped, but no forced decimals. */
export function fmtQuantity(val: string | number | null | undefined, maxFractionDigits = 6): string {
  const n = parseAmount(val);
  if (n === null) return "—";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n);
}

/** Percentages carry an explicit sign and the same true-minus rule. */
export function fmtPct(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return `${val < 0 ? MINUS : "+"}${Math.abs(val).toFixed(2)}%`;
}
