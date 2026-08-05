import { router } from "@inertiajs/react";
import { Pencil } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, jsonFetch } from "@/lib/api";
import { fmt, useCurrencySymbol } from "@/utils/currency";
import { fmtDate } from "@/utils/date";
import {
  type RecurringFormCategory,
  type RecurringFormChoice,
  RecurringFormModal,
  type RecurringFormPaymentMethod,
  type RecurringRecord,
} from "./RecurringFormModal";

export interface RecurringPanelItem extends RecurringRecord {
  category_name: string;
  category_type: "income" | "expense";
  payment_method_name: string | null;
  next_due_date: string | null;
}

interface Props {
  budgetPk: number;
  recurring: RecurringPanelItem[];
  categories: RecurringFormCategory[];
  paymentMethods: RecurringFormPaymentMethod[];
  freqChoices: RecurringFormChoice[];
  onChange: (next: RecurringPanelItem[]) => void;
}

function freqLabel(rt: RecurringPanelItem): string {
  const labels: Record<string, string> = { monthly: "Monthly", every_n_months: "Every N Months", annually: "Annually" };
  const base = labels[rt.frequency] ?? rt.frequency;
  return rt.frequency === "every_n_months" ? `${base} (${rt.interval}mo)` : base;
}

function groupByCategory(items: RecurringPanelItem[]) {
  const groups = new Map<number, { category_name: string; category_type: string; items: RecurringPanelItem[] }>();
  const sorted = [...items].sort((a, b) => {
    const typeOrder = { income: 0, expense: 1 } as const;
    const tA = typeOrder[a.category_type] ?? 2;
    const tB = typeOrder[b.category_type] ?? 2;
    if (tA !== tB) return tA - tB;
    const catCmp = a.category_name.localeCompare(b.category_name);
    if (catCmp !== 0) return catCmp;
    return a.start_date.localeCompare(b.start_date);
  });
  for (const rt of sorted) {
    if (!groups.has(rt.category)) {
      groups.set(rt.category, { category_name: rt.category_name, category_type: rt.category_type, items: [] });
    }
    groups.get(rt.category)!.items.push(rt);
  }
  return Array.from(groups.values());
}

export function RecurringPanel({ budgetPk, recurring, categories, paymentMethods, freqChoices, onChange }: Props) {
  const symbol = useCurrencySymbol();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringPanelItem | null>(null);

  async function handleDelete(rt: RecurringPanelItem) {
    try {
      await jsonFetch(`/budgets/${budgetPk}/recurring/${rt.id}/`, "DELETE");
      onChange(recurring.filter((r) => r.id !== rt.id));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete that recurring transaction."));
    }
  }

  const groups = groupByCategory(recurring);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold">Recurring Transactions</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          + Add
        </Button>
      </div>

      {recurring.length === 0 ? (
        <Card>
          <CardContent className="text-ink-quiet py-12 text-center">No recurring transactions yet.</CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[24%]">Name</TableHead>
                  <TableHead className="w-[15%]">Frequency</TableHead>
                  <TableHead className="w-[16%]">Payment Method</TableHead>
                  <TableHead className="w-[11%] text-right">Amount</TableHead>
                  <TableHead className="w-[12%]">Start</TableHead>
                  <TableHead className="w-[12%]">Next due</TableHead>
                  <TableHead className="w-[18%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <Fragment key={group.category_name}>
                    <TableRow className="bg-moss-soft hover:bg-moss-soft">
                      <TableCell colSpan={7} className="py-1.5">
                        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink">
                          {group.category_name}
                        </span>
                        <span className="text-ink-quiet text-xs ml-2">
                          {group.category_type === "income" ? "Income" : "Expense"}
                        </span>
                      </TableCell>
                    </TableRow>
                    {group.items.map((rt) => (
                      <TableRow key={rt.id} className="group">
                        <TableCell>
                          <span className="font-medium">{rt.name}</span>
                        </TableCell>
                        <TableCell className="text-sm">{freqLabel(rt)}</TableCell>
                        <TableCell className="text-sm">
                          {rt.payment_method_name ?? <span className="text-ink-quiet">—</span>}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm tabular-nums ${rt.category_type === "income" ? "text-income" : "text-expense"}`}
                        >
                          {rt.category_type === "expense" ? "−" : ""}
                          {fmt(rt.amount, symbol)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{fmtDate(rt.start_date)}</TableCell>
                        {/* Empty means the schedule has stopped — it is past its end date. That
                            reading replaces the Active/inactive status column. */}
                        <TableCell className="text-sm tabular-nums">
                          {rt.next_due_date ? fmtDate(rt.next_due_date) : <span className="text-ink-quiet">—</span>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="inline-flex gap-1 items-center opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setEditing(rt);
                                setShowForm(true);
                              }}
                              aria-label="Edit recurring transaction"
                            >
                              <Pencil />
                            </Button>
                            <ConfirmButton size="xs" onConfirm={() => handleDelete(rt)} label="Delete" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {showForm && (
        <RecurringFormModal
          budgetPk={budgetPk}
          recurring={editing}
          categories={categories}
          paymentMethods={paymentMethods}
          freqChoices={freqChoices}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            router.reload({ only: ["recurring"] });
          }}
        />
      )}
    </div>
  );
}
