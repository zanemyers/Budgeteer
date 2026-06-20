import { useState } from "react";
import { Pencil } from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentMethodModal } from "./PaymentMethodModal";
import { getCsrfToken } from "@/lib/api";

export interface PaymentMethod {
  id: number;
  name: string;
  payment_type: string;
  payment_type_display: string;
  last_four: string;
  is_active: boolean;
}

interface TypeChoice {
  value: string;
  label: string;
}

interface Props {
  budgetPk: number;
  paymentMethods: PaymentMethod[];
  typeChoices: TypeChoice[];
  onChange: (next: PaymentMethod[]) => void;
}

export function PaymentMethodsPanel({ budgetPk, paymentMethods, typeChoices, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});

  function upsert(pm: PaymentMethod) {
    const exists = paymentMethods.some((m) => m.id === pm.id);
    onChange(exists ? paymentMethods.map((m) => (m.id === pm.id ? pm : m)) : [...paymentMethods, pm]);
  }

  async function handleDelete(pm: PaymentMethod) {
    const res = await fetch(`/budgets/${budgetPk}/payment-methods/${pm.id}/`, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    if (res.ok || res.status === 204) {
      onChange(paymentMethods.filter((m) => m.id !== pm.id));
    } else {
      setDeleteError((prev) => ({ ...prev, [pm.id]: "Cannot delete — payment method is in use." }));
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold">Payment methods</h2>
        <Button size="sm" onClick={() => setAdding(true)}>+ Add</Button>
      </div>

      {paymentMethods.length === 0 ? (
        <Card>
          <CardContent className="text-center py-10">
            <p className="text-sm text-muted-foreground">No payment methods yet.</p>
            <button
              type="button"
              className="text-sm text-primary hover:underline mt-1 cursor-pointer"
              onClick={() => setAdding(true)}
            >
              + Add your first
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {paymentMethods.map((pm) => (
            <div
              key={pm.id}
              className="flex justify-between items-center gap-3 p-3 rounded-lg border border-border-strong bg-card shadow-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">{pm.name}</span>
                <span className="text-muted-foreground text-sm truncate">
                  {pm.payment_type_display}{pm.last_four && ` ···· ${pm.last_four}`}
                </span>
                {!pm.is_active && <Badge variant="secondary">Inactive</Badge>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {deleteError[pm.id] && <small className="text-destructive">{deleteError[pm.id]}</small>}
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(pm)} aria-label="Edit payment method"><Pencil /></Button>
                <ConfirmButton onConfirm={() => handleDelete(pm)} label="Delete" />
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <PaymentMethodModal
          budgetPk={budgetPk}
          typeChoices={typeChoices}
          paymentMethod={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(pm) => {
            upsert(pm);
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
