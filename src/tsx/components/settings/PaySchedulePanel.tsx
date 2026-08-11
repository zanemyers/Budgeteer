import { router } from "@inertiajs/react";
import { useState } from "react";
import { toast } from "sonner";
import { RowActions } from "@/components/RowActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, jsonFetch } from "@/lib/api";
import { fmt, useCurrencySymbol } from "@/utils/currency";
import {
  type PaySchedule,
  type PayScheduleCategory,
  type PayScheduleChoice,
  PayScheduleFormModal,
  type PaySchedulePaymentMethod,
} from "./PayScheduleFormModal";

export type { PaySchedule } from "./PayScheduleFormModal";

interface Props {
  budgetPk: number;
  paySchedules: PaySchedule[];
  freqChoices: PayScheduleChoice[];
  incomeCategories: PayScheduleCategory[];
  paymentMethods: PaySchedulePaymentMethod[];
  isOwner: boolean;
}

function freqLabel(schedule: PaySchedule, choices: PayScheduleChoice[]): string {
  return choices.find((c) => c.value === schedule.frequency)?.label ?? schedule.frequency;
}

function matchSummary(schedule: PaySchedule, symbol: string): string {
  const parts: string[] = [];
  if (schedule.expected_amount) parts.push(`~${fmt(schedule.expected_amount, symbol)}`);
  if (schedule.match_text) parts.push(`"${schedule.match_text}"`);
  return parts.length ? parts.join(" · ") : "Any income";
}

export function PaySchedulePanel({
  budgetPk,
  paySchedules,
  freqChoices,
  incomeCategories,
  paymentMethods,
  isOwner,
}: Props) {
  const symbol = useCurrencySymbol();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PaySchedule | null>(null);

  async function handleDelete(schedule: PaySchedule) {
    try {
      await jsonFetch(`/budgets/${budgetPk}/pay-schedules/${schedule.id}/`, "DELETE");
      router.reload({ only: ["pay_schedules"] });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete that pay schedule."));
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-base font-semibold">Pay Schedules</h2>
        {isOwner && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + Add
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        One per income source (job). Each decides which budget month its paychecks fund — choose "the following month"
        to budget a month ahead out of surplus.
      </p>

      {paySchedules.length === 0 ? (
        <Card>
          <CardContent className="text-ink-quiet py-12 text-center">No pay schedules yet.</CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              {/* Header hides in lockstep with the body cells below md, or the remaining columns stop
                  lining up with their data. */}
              <TableHeader className="hidden md:table-header-group">
                <TableRow>
                  <TableHead className="w-[22%]">Name</TableHead>
                  <TableHead className="w-[16%]">Category</TableHead>
                  {/* Account and Matches wait for xl, not lg: the match summary alone claimed over 300px,
                      and lg is where the 240px sidebar becomes persistent — so revealing them at lg
                      overflowed a content area that had just shrunk. */}
                  <TableHead className="hidden xl:table-cell w-[16%]">Account</TableHead>
                  <TableHead className="w-[14%]">Frequency</TableHead>
                  <TableHead className="hidden xl:table-cell w-[18%]">Matches</TableHead>
                  {isOwner && <TableHead className="w-[14%] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paySchedules.map((schedule) => (
                  <TableRow key={schedule.id} className="group">
                    <TableCell>
                      <span className="font-medium">{schedule.name}</span>
                      {/* Below md the four hidden columns collapse to the two readings that identify a
                          schedule: what it pays into, and how often. */}
                      <div className="md:hidden mt-0.5 text-xs text-ink-quiet">
                        {schedule.category_name ?? "—"}
                        {` · ${freqLabel(schedule, freqChoices)}`}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-ink-quiet">
                      {schedule.category_name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-sm text-ink-quiet">
                      {schedule.payment_method_name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {freqLabel(schedule, freqChoices)}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-sm text-ink-quiet">
                      {matchSummary(schedule, symbol)}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="inline-flex gap-1 items-center opacity-60 group-hover:opacity-100 touch:opacity-100 focus-within:opacity-100 transition-opacity">
                          <RowActions
                            name={schedule.name}
                            noun="pay schedule"
                            onEdit={() => {
                              setEditing(schedule);
                              setShowForm(true);
                            }}
                            onDelete={() => handleDelete(schedule)}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {showForm && (
        <PayScheduleFormModal
          budgetPk={budgetPk}
          schedule={editing}
          freqChoices={freqChoices}
          incomeCategories={incomeCategories}
          paymentMethods={paymentMethods}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            router.reload({ only: ["pay_schedules"] });
          }}
        />
      )}
    </div>
  );
}
