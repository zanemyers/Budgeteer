import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfToken } from "@/lib/api";
import { todayLocal } from "@/utils/date";

export interface RecurringFormCategory {
  id: number;
  name: string;
  category_type: "income" | "expense";
}

export interface RecurringFormPaymentMethod {
  id: number;
  name: string;
  last_four: string;
  is_active: boolean;
}

export interface RecurringFormChoice {
  value: string;
  label: string;
}

export interface RecurringRecord {
  id: number;
  name: string;
  description: string;
  amount: string;
  category: number;
  frequency: string;
  interval: number;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  payment_method: number | null;
}

interface Props {
  budgetPk: number;
  recurring: RecurringRecord | null;
  categories: RecurringFormCategory[];
  paymentMethods: RecurringFormPaymentMethod[];
  freqChoices: RecurringFormChoice[];
  onClose: () => void;
  onSaved: () => void;
}

export function RecurringFormModal({
  budgetPk,
  recurring,
  categories,
  paymentMethods,
  freqChoices,
  onClose,
  onSaved,
}: Props) {
  const isEdit = recurring !== null;

  const [name, setName] = useState(recurring?.name ?? "");
  const [category, setCategory] = useState(String(recurring?.category ?? ""));
  const [amount, setAmount] = useState(recurring?.amount ?? "");
  const [frequency, setFrequency] = useState(recurring?.frequency ?? freqChoices[0]?.value ?? "monthly");
  const [interval, setIntervalValue] = useState(String(recurring?.interval ?? "1"));
  const [startDate, setStartDate] = useState(recurring?.start_date ?? todayLocal());
  const [endDate, setEndDate] = useState(recurring?.end_date ?? "");
  const [description, setDescription] = useState(recurring?.description ?? "");
  const [paymentMethod, setPaymentMethod] = useState(String(recurring?.payment_method ?? ""));
  const [isActive, setIsActive] = useState(recurring?.is_active ?? true);
  const [deleteFutureUnpaid, setDeleteFutureUnpaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function fieldError(field: string): string | null {
    return errors[field]?.[0] ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const payload: Record<string, string | number | boolean | null> = {
      name,
      category: parseInt(category, 10),
      amount,
      frequency,
      start_date: startDate,
      is_active: isActive,
    };
    if (frequency === "every_n_months") payload.interval = parseInt(interval, 10);
    if (endDate) payload.end_date = endDate;
    if (description) payload.description = description;
    if (paymentMethod) payload.payment_method = parseInt(paymentMethod, 10);
    if (isEdit && deleteFutureUnpaid) payload.delete_future_unpaid = true;

    const url = isEdit ? `/budgets/${budgetPk}/recurring/${recurring!.id}/` : `/budgets/${budgetPk}/recurring/create/`;

    try {
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json()) as { errors?: Record<string, string[]> };
        setErrors(data.errors ?? { non_field_errors: ["Something went wrong."] });
        setSubmitting(false);
        return;
      }
      onSaved();
    } catch {
      setErrors({ non_field_errors: ["Something went wrong."] });
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Recurring Transaction" : "New Recurring Transaction"}</DialogTitle>
          </DialogHeader>

          <div className="py-4 flex flex-col gap-4">
            {errors.non_field_errors && (
              <Alert variant="destructive">
                <AlertDescription>{errors.non_field_errors.join(" ")}</AlertDescription>
              </Alert>
            )}

            {isEdit && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="delete_future_unpaid"
                  checked={deleteFutureUnpaid}
                  onCheckedChange={(c) => setDeleteFutureUnpaid(c === true)}
                />
                <Label htmlFor="delete_future_unpaid" className="font-normal text-sm">
                  Delete and regenerate future unpaid instances with new settings
                </Label>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rt-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rt-name"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  required
                  aria-invalid={!!fieldError("name")}
                />
                {fieldError("name") && <p className="text-destructive text-sm">{fieldError("name")}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rt-category">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="rt-category" className="w-full" aria-invalid={!!fieldError("category")}>
                    <SelectValue placeholder="-- Select --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Income</SelectLabel>
                      {categories
                        .filter((c) => c.category_type === "income")
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Expense</SelectLabel>
                      {categories
                        .filter((c) => c.category_type === "expense")
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldError("category") && <p className="text-destructive text-sm">{fieldError("category")}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-2 md:col-span-1">
                <Label htmlFor="rt-amount">
                  Amount <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rt-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  aria-invalid={!!fieldError("amount")}
                />
                {fieldError("amount") && <p className="text-destructive text-sm">{fieldError("amount")}</p>}
              </div>

              <div className="flex flex-col gap-2 md:col-span-1">
                <Label htmlFor="rt-frequency">
                  Frequency <span className="text-destructive">*</span>
                </Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger id="rt-frequency" className="w-full" aria-invalid={!!fieldError("frequency")}>
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

              {frequency === "every_n_months" && (
                <div className="flex flex-col gap-2 md:col-span-1">
                  <Label htmlFor="rt-interval">Every (months)</Label>
                  <Input
                    id="rt-interval"
                    type="number"
                    min={2}
                    value={interval}
                    onChange={(e) => setIntervalValue(e.target.value)}
                    aria-invalid={!!fieldError("interval")}
                  />
                  {fieldError("interval") && <p className="text-destructive text-sm">{fieldError("interval")}</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rt-start">
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rt-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  aria-invalid={!!fieldError("start_date")}
                />
                {fieldError("start_date") && <p className="text-destructive text-sm">{fieldError("start_date")}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rt-end">End Date</Label>
                <Input id="rt-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rt-pm">Payment Method</Label>
              <Select value={paymentMethod || "none"} onValueChange={(v) => setPaymentMethod(v === "none" ? "" : v)}>
                <SelectTrigger id="rt-pm" className="w-full">
                  <SelectValue />
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
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rt-description">Description</Label>
              <Textarea
                id="rt-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {isEdit && (
              <div className="flex items-center gap-2">
                <Checkbox id="rt-is-active" checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
                <Label htmlFor="rt-is-active" className="font-normal">
                  Active
                </Label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
