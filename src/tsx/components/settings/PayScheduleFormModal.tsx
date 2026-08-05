import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldErrors, jsonFetch } from "@/lib/api";

export interface PaySchedule {
  id: number;
  name: string;
  category: number | null;
  category_name: string | null;
  payment_method: number | null;
  payment_method_name: string | null;
  frequency: string;
  anchor_1: string;
  anchor_2: string;
  anchor_date: string | null;
  allocation_offset_months: number;
  expected_amount: string | null;
  match_text: string;
}

export interface PayScheduleChoice {
  value: string;
  label: string;
}

export interface PayScheduleCategory {
  id: number;
  name: string;
}

export interface PaySchedulePaymentMethod {
  id: number;
  name: string;
  last_four: string;
  is_active: boolean;
}

const ANCHOR_LABELS: Record<string, string> = {
  beginning: "Beginning of the month",
  middle: "Middle of the month",
  end: "End of the month",
};
const ANCHOR_RANK: Record<string, number> = { beginning: 0, middle: 1, end: 2 };

interface AllocationLine {
  when: string;
  funds: string;
}

function allocationPreview(frequency: string, anchor1: string, anchor2: string, offset: number): AllocationLine[] {
  const same = "funds that month";
  const next = "funds the next month";
  const fundsFor = (o: number) => (o >= 1 ? next : same);

  if (frequency === "semimonthly") {
    if (!anchor1 || !anchor2) return [{ when: "Each paycheck", funds: fundsFor(offset) }];
    const [earlier, later] = ANCHOR_RANK[anchor1] <= ANCHOR_RANK[anchor2] ? [anchor1, anchor2] : [anchor2, anchor1];
    // Budgeting ahead shifts only the later paycheck; the earlier one funds its own month.
    return [
      { when: ANCHOR_LABELS[earlier], funds: same },
      { when: ANCHOR_LABELS[later], funds: fundsFor(offset) },
    ];
  }
  if (frequency === "monthly") {
    return [{ when: anchor1 ? ANCHOR_LABELS[anchor1] : "Your paycheck", funds: fundsFor(offset) }];
  }
  return [{ when: "Each paycheck", funds: fundsFor(offset) }];
}

interface Props {
  budgetPk: number;
  schedule: PaySchedule | null;
  freqChoices: PayScheduleChoice[];
  incomeCategories: PayScheduleCategory[];
  paymentMethods: PaySchedulePaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
}

export function PayScheduleFormModal({
  budgetPk,
  schedule,
  freqChoices,
  incomeCategories,
  paymentMethods,
  onClose,
  onSaved,
}: Props) {
  const isEdit = schedule !== null;

  const [name, setName] = useState(schedule?.name ?? "");
  const [category, setCategory] = useState(schedule?.category ? String(schedule.category) : "");
  const [paymentMethod, setPaymentMethod] = useState(schedule?.payment_method ? String(schedule.payment_method) : "");
  const [frequency, setFrequency] = useState(schedule?.frequency ?? freqChoices[0]?.value ?? "monthly");
  const [anchor1, setAnchor1] = useState(schedule?.anchor_1 ?? "");
  const [anchor2, setAnchor2] = useState(schedule?.anchor_2 ?? "");
  const [anchorDate, setAnchorDate] = useState(schedule?.anchor_date ?? "");
  const [offset, setOffset] = useState((schedule?.allocation_offset_months ?? 0).toString());
  const [expectedAmount, setExpectedAmount] = useState(schedule?.expected_amount ?? "");
  const [matchText, setMatchText] = useState(schedule?.match_text ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const usesDays = frequency === "monthly" || frequency === "semimonthly";
  const usesDate = frequency === "biweekly" || frequency === "weekly";
  const allocationLines = allocationPreview(frequency, anchor1, anchor2, Number(offset));

  function fieldError(field: string): string | null {
    return errors[field]?.[0] ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const payload: Record<string, string | number | null> = {
      name,
      category: category ? Number(category) : null,
      payment_method: paymentMethod ? Number(paymentMethod) : null,
      frequency,
      allocation_offset_months: Number(offset),
      anchor_1: usesDays ? anchor1 : "",
      anchor_2: frequency === "semimonthly" ? anchor2 : "",
      anchor_date: usesDate ? anchorDate || null : null,
      expected_amount: expectedAmount || null,
      match_text: matchText,
    };

    const url = isEdit ? `/budgets/${budgetPk}/pay-schedules/${schedule!.id}/` : `/budgets/${budgetPk}/pay-schedules/`;

    try {
      await jsonFetch(url, isEdit ? "PATCH" : "POST", payload);
      onSaved();
    } catch (err) {
      // fieldErrors keeps a validation map intact and routes everything else — session
      // expiry, a dropped connection, an HTML error page — to non_field_errors. Previously
      // the bare catch flattened all of those into one generic string, and the branch above
      // called res.json() unguarded so an HTML response threw past it entirely.
      setErrors(fieldErrors(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit pay schedule" : "Add pay schedule"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errors.non_field_errors && (
            <Alert variant="destructive">
              <AlertDescription>{errors.non_field_errors[0]}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="ps-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ps-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My job — Acme"
              required
              aria-invalid={!!fieldError("name")}
            />
            {fieldError("name") && <p className="text-destructive text-sm">{fieldError("name")}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ps-category">Income category</Label>
            <Select value={category || "none"} onValueChange={(v) => setCategory(v === "none" ? "" : v)}>
              <SelectTrigger id="ps-category" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {incomeCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Paychecks matched to this schedule are recorded here (e.g. when created from a bank deposit).
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ps-payment-method">Deposit account</Label>
            <Select value={paymentMethod || "none"} onValueChange={(v) => setPaymentMethod(v === "none" ? "" : v)}>
              <SelectTrigger id="ps-payment-method" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {paymentMethods
                  .filter((m) => m.is_active)
                  .map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                      {m.last_four ? ` ···${m.last_four}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The account paychecks land in. Pre-fills the payment method on generated paychecks.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ps-frequency">How you're paid</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="ps-frequency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {freqChoices.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ps-offset">Allocate income to</Label>
              <Select value={offset} onValueChange={setOffset}>
                <SelectTrigger id="ps-offset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">The month it's received</SelectItem>
                  <SelectItem value="1">The following month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {usesDays && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ps-anchor1">{frequency === "semimonthly" ? "First payday" : "Payday"}</Label>
                <Select value={anchor1 || "unset"} onValueChange={(v) => setAnchor1(v === "unset" ? "" : v)}>
                  <SelectTrigger id="ps-anchor1" className="w-full">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">—</SelectItem>
                    <SelectItem value="beginning">Beginning of the month</SelectItem>
                    <SelectItem value="middle">Middle of the month</SelectItem>
                    {frequency !== "semimonthly" && <SelectItem value="end">End of the month</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {frequency === "semimonthly" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ps-anchor2">Second payday</Label>
                  <Select value={anchor2 || "unset"} onValueChange={(v) => setAnchor2(v === "unset" ? "" : v)}>
                    <SelectTrigger id="ps-anchor2" className="w-full">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">—</SelectItem>
                      <SelectItem value="middle">Middle of the month</SelectItem>
                      <SelectItem value="end">End of the month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {usesDate && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ps-date">A recent payday</Label>
              <Input
                id="ps-date"
                type="date"
                className="w-48"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Used to project the every-two-weeks / weekly cadence.</p>
            </div>
          )}

          <div className="rounded-md border border-rule bg-muted/40 p-3">
            <p className="text-sm font-medium mb-1.5">How paychecks are allocated</p>
            <ul className="space-y-1">
              {allocationLines.map((line) => (
                <li key={line.when} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{line.when}</span>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                  <span className={line.funds.includes("next") ? "text-moss font-medium" : "text-foreground"}>
                    {line.funds}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ps-amount">Expected amount</Label>
              <Input
                id="ps-amount"
                type="number"
                step="0.01"
                min="0"
                value={expectedAmount}
                onChange={(e) => setExpectedAmount(e.target.value)}
                placeholder="Optional — blank for variable pay"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ps-match">Description contains</Label>
              <Input
                id="ps-match"
                value={matchText}
                onChange={(e) => setMatchText(e.target.value)}
                placeholder="e.g. ACME PAYROLL"
              />
            </div>
            <p className="text-xs text-muted-foreground md:col-span-2">
              Used to match a paycheck to this schedule — by amount and/or the transaction description or bank payee.
              For variable pay, leave the amount blank and match on the description alone. With a category set, upcoming
              paychecks are added automatically; a set amount pre-fills them, otherwise they stay blank until you enter
              the amount (required to mark one paid).
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save" : "Add schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
