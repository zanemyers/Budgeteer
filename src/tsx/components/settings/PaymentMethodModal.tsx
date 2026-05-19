import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PaymentMethod } from "./PaymentMethodsPanel";

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  budgetPk: number;
  typeChoices: TypeChoice[];
  paymentMethod?: PaymentMethod | null;
  onClose: () => void;
  onSaved: (pm: PaymentMethod) => void;
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

export function PaymentMethodModal({ budgetPk, typeChoices, paymentMethod, onClose, onSaved }: Props) {
  const isEdit = !!paymentMethod;
  const [name, setName] = useState(paymentMethod?.name ?? "");
  const [paymentType, setPaymentType] = useState(paymentMethod?.payment_type ?? typeChoices[0]?.value ?? "");
  const [lastFour, setLastFour] = useState(paymentMethod?.last_four ?? "");
  const [isActive, setIsActive] = useState(paymentMethod?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const url = isEdit
      ? `/budgets/${budgetPk}/payment-methods/${paymentMethod!.id}/`
      : `/budgets/${budgetPk}/payment-methods/`;
    const method = isEdit ? "PATCH" : "POST";
    const body: Record<string, unknown> = {
      name,
      payment_type: paymentType,
      last_four: lastFour,
    };
    if (isEdit) body.is_active = isActive;

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { errors?: Record<string, string[]> };
        const flat = Object.values(data.errors ?? data).flat().join(" ");
        setError(flat || "Could not save.");
        setSaving(false);
        return;
      }
      const pm = await res.json() as PaymentMethod;
      onSaved(pm);
    } catch {
      setError("Network error.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit payment method" : "Add payment method"}</DialogTitle>
          </DialogHeader>

          <div className="py-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-name">Name</Label>
              <Input
                id="pm-name"
                placeholder="e.g. Chase Sapphire"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pm-type">Type</Label>
                <Select value={paymentType} onValueChange={setPaymentType}>
                  <SelectTrigger id="pm-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {typeChoices.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="pm-last-four">
                  Last 4 <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="pm-last-four"
                  placeholder="1234"
                  maxLength={4}
                  value={lastFour}
                  onChange={(e) => setLastFour(e.target.value)}
                />
              </div>
            </div>

            {isEdit && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pm-active"
                  checked={isActive}
                  onCheckedChange={(c) => setIsActive(c === true)}
                />
                <Label htmlFor="pm-active" className="font-normal">Active</Label>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
