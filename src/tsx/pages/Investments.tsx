import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, fmtPct, fmtQuantity, useCurrencySymbol } from "../utils/currency";
import { fmtDate } from "../utils/date";

interface Holding {
  id: number;
  symbol: string;
  description: string;
  shares: string | null;
  cost_basis: string | null;
  market_value: string | null;
  purchase_price: string | null;
  currency: string;
  unrealized_gain: string | null;
  unrealized_gain_pct: number | null;
  weight_pct: number | null;
}

interface InvestmentAccount {
  id: number;
  name: string;
  org_name: string;
  org_domain: string;
  currency: string;
  balance: string | null;
  balance_as_of: string | null;
  market_value: string | null;
  cost_basis: string | null;
  unrealized_gain: string | null;
  unrealized_gain_pct: number | null;
  holdings: Holding[];
}

interface Portfolio {
  market_value: string;
  cost_basis: string | null;
  unrealized_gain: string | null;
  unrealized_gain_pct: number | null;
}

interface Props {
  accounts: InvestmentAccount[];
  portfolio: Portfolio;
}

function gainClass(val: string | number | null): string {
  if (val === null || val === undefined || val === "") return "";
  const n = typeof val === "string" ? Number.parseFloat(val) : val;
  if (Number.isNaN(n) || n === 0) return "";
  return n > 0 ? "text-income" : "text-expense";
}

export default function Investments({ accounts, portfolio }: Props) {
  const symbol = useCurrencySymbol();
  // Collapsed by default. The header already carries market value, unrealized gain and a position
  // count, so opening one is a deliberate "show me the holdings"; expanding every account on load
  // just put a long table between the reader and the next account.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalHoldings = useMemo(() => accounts.reduce((s, a) => s + a.holdings.length, 0), [accounts]);

  return (
    <div className="max-w-[1200px]">
      <header className="flex justify-between items-end mb-8 flex-wrap gap-4">
        <div>
          {/* sr-only, not deleted: the sidebar and the mobile breadcrumb already name the page, but
              the document still needs one heading and a screen reader still needs to hear it. */}
          <h1 className="sr-only">Investments</h1>
          <p className="text-ink-quiet text-sm">
            {accounts.length > 0
              ? `${totalHoldings} position${totalHoldings === 1 ? "" : "s"} across ${accounts.length} account${accounts.length === 1 ? "" : "s"}.`
              : "No investment accounts yet."}
          </p>
        </div>
      </header>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-ink-quiet">
            Connect a brokerage via SimpleFIN to see your positions here.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-8">
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6 py-6">
              <div>
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                  Portfolio value
                </div>
                <div className="text-2xl font-semibold tabular-nums mt-1">{fmt(portfolio.market_value, symbol)}</div>
              </div>
              <div>
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                  Cost basis
                </div>
                <div className="text-2xl font-semibold tabular-nums mt-1">{fmt(portfolio.cost_basis, symbol)}</div>
              </div>
              <div>
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                  Unrealized gain
                </div>
                <div className={`text-2xl font-semibold tabular-nums mt-1 ${gainClass(portfolio.unrealized_gain)}`}>
                  {fmt(portfolio.unrealized_gain, symbol)}
                </div>
              </div>
              <div>
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">Return</div>
                <div className={`text-2xl font-semibold tabular-nums mt-1 ${gainClass(portfolio.unrealized_gain_pct)}`}>
                  {fmtPct(portfolio.unrealized_gain_pct)}
                </div>
              </div>
            </CardContent>
          </Card>

          {accounts.map((acct) => {
            const isOpen = expanded.has(acct.id);
            return (
              <section key={acct.id} className="mb-6">
                <Card className="overflow-hidden p-0">
                  <button
                    type="button"
                    onClick={() => toggle(acct.id)}
                    className="w-full flex flex-col md:flex-row md:justify-between md:items-center gap-2 md:gap-4 px-4 md:px-6 py-4 hover:bg-muted/40 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-3 min-w-0 w-full md:w-auto">
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{acct.name}</div>
                        <div className="text-xs text-ink-quiet truncate">
                          {acct.org_name}
                          {acct.balance_as_of ? ` · as of ${fmtDate(acct.balance_as_of)}` : ""}
                          {" · "}
                          {acct.holdings.length} position{acct.holdings.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    {/* Below md these figures drop to their own row under the name, indented to clear the
                        chevron. Sharing one line left the account name about 40px — enough to render
                        "Joi…" and nothing more. The column labels only earn their space on desktop. */}
                    <div className="flex items-baseline justify-between md:justify-end gap-6 shrink-0 w-full md:w-auto pl-7 md:pl-0">
                      <div className="md:text-right">
                        <div className="hidden md:block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                          Market value
                        </div>
                        <div className="font-semibold tabular-nums">{fmt(acct.market_value, symbol)}</div>
                      </div>
                      <div className="text-right">
                        <div className="hidden md:block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-quiet">
                          Gain
                        </div>
                        <div className={`font-semibold tabular-nums ${gainClass(acct.unrealized_gain)}`}>
                          {fmt(acct.unrealized_gain, symbol)}
                          {acct.unrealized_gain_pct !== null && (
                            <span className="ml-2 text-xs">({fmtPct(acct.unrealized_gain_pct)})</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-rule overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="hidden lg:table-cell">Description</TableHead>
                            <TableHead className="text-right">Shares</TableHead>
                            <TableHead className="text-right hidden md:table-cell">Price</TableHead>
                            <TableHead className="text-right hidden lg:table-cell">Cost basis</TableHead>
                            <TableHead className="text-right">Market value</TableHead>
                            <TableHead className="text-right">Gain</TableHead>
                            <TableHead className="text-right hidden md:table-cell">Return</TableHead>
                            <TableHead className="text-right hidden lg:table-cell">Weight</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {acct.holdings.map((h) => (
                            <TableRow key={h.id}>
                              <TableCell className="font-medium tabular-nums">{h.symbol || "—"}</TableCell>
                              <TableCell className="hidden lg:table-cell text-sm text-ink-quiet">
                                {h.description || "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fmtQuantity(h.shares)}</TableCell>
                              <TableCell className="text-right tabular-nums hidden md:table-cell">
                                {fmt(h.purchase_price, symbol)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums hidden lg:table-cell">
                                {fmt(h.cost_basis, symbol)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fmt(h.market_value, symbol)}</TableCell>
                              <TableCell className={`text-right tabular-nums ${gainClass(h.unrealized_gain)}`}>
                                {fmt(h.unrealized_gain, symbol)}
                              </TableCell>
                              <TableCell
                                className={`text-right tabular-nums hidden md:table-cell ${gainClass(h.unrealized_gain_pct)}`}
                              >
                                {fmtPct(h.unrealized_gain_pct)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-ink-quiet hidden lg:table-cell">
                                {h.weight_pct === null ? "—" : `${h.weight_pct.toFixed(1)}%`}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              </section>
            );
          })}
        </>
      )}

      {accounts.length === 0 && (
        <div className="mt-6 text-center">
          <Button asChild variant="outline">
            <a href="/accounts/settings/">Manage connections</a>
          </Button>
        </div>
      )}
    </div>
  );
}
