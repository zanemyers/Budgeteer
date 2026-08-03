import { router } from "@inertiajs/react";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfToken } from "@/lib/api";
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
    const res = await fetch(`/budgets/${budgetPk}/pay-schedules/${schedule.id}/`, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    if (res.ok || res.status === 204) {
      router.reload({ only: ["pay_schedules"] });
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
        <Card className="border-rule shadow-none">
          <CardContent className="text-ink-quiet py-12 text-center">No pay schedules yet.</CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border-rule shadow-none">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Name</TableHead>
                  <TableHead className="w-[16%]">Category</TableHead>
                  <TableHead className="w-[16%]">Account</TableHead>
                  <TableHead className="w-[14%]">Frequency</TableHead>
                  <TableHead className="w-[18%]">Matches</TableHead>
                  {isOwner && <TableHead className="w-[14%] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paySchedules.map((schedule) => (
                  <TableRow key={schedule.id} className="group">
                    <TableCell>
                      <span className="font-medium">{schedule.name}</span>
                    </TableCell>
                    <TableCell className="text-sm text-ink-quiet">{schedule.category_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-ink-quiet">{schedule.payment_method_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{freqLabel(schedule, freqChoices)}</TableCell>
                    <TableCell className="text-sm text-ink-quiet">{matchSummary(schedule, symbol)}</TableCell>
                    {isOwner && (
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="inline-flex gap-1 items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setEditing(schedule);
                              setShowForm(true);
                            }}
                            aria-label="Edit pay schedule"
                          >
                            <Pencil />
                          </Button>
                          <ConfirmButton size="xs" onConfirm={() => handleDelete(schedule)} label="Delete" />
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
