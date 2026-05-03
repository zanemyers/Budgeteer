import { usePage } from "@inertiajs/react";

interface PageProps {
  auth?: { user?: { currency_symbol?: string; currency_code?: string } };
}

export function useCurrencySymbol(): string {
  const { props } = usePage<PageProps>();
  return props.auth?.user?.currency_symbol ?? "$";
}

export function fmt(val: string | number, symbol = "$"): string {
  return `${symbol}${parseFloat(String(val)).toFixed(2)}`;
}
