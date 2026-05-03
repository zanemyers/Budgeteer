import { usePage } from "@inertiajs/react";

interface PageProps {
  auth?: { user?: { currency_symbol?: string; currency_code?: string; currency_rate?: string } };
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

export function fmt(val: string | number, symbol = "$"): string {
  return `${symbol}${parseFloat(String(val)).toFixed(2)}`;
}

export function fmtConverted(
  amount: string | number,
  txnRate: string | number,
  userRate: string | number,
  symbol = "$"
): string {
  const a = parseFloat(String(amount));
  const tr = parseFloat(String(txnRate)) || 1;
  const ur = parseFloat(String(userRate)) || 1;
  return `${symbol}${(a * (ur / tr)).toFixed(2)}`;
}
