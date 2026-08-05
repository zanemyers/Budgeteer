import { Upload } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCsrfToken } from "@/lib/api";
import type { PaymentMethod } from "@/types";

/** The roles a column can fill. Date and amount are the only two a file cannot do without. */
const ROLES = [
  { key: "date", label: "Date", required: true },
  { key: "amount", label: "Amount (signed)", required: false },
  { key: "debit", label: "Debit / money out", required: false },
  { key: "credit", label: "Credit / money in", required: false },
  { key: "description", label: "Description", required: false },
  { key: "category", label: "Category", required: false },
  { key: "note", label: "Memo", required: false },
  { key: "card", label: "Card number", required: false },
] as const;

type Mapping = Record<string, number | string | boolean | null>;

interface Preview {
  header: string[];
  mapping: Mapping;
  row_count: number;
  outflow_count: number;
  inflow_count: number;
  cards: string[];
  unmatched_cards: string[];
  skipped: { line: number; reason: string }[];
  sample: {
    line: number;
    date: string;
    amount: string;
    direction: string;
    description: string;
    category: string;
    card: string;
  }[];
}

interface Result {
  batch: string;
  created: number;
  duplicates: number;
  logged: number;
  unmatched_cards: string[];
  skipped: { line: number; reason: string }[];
}

interface Props {
  budgetPk: number;
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onImported: () => void;
}

/**
 * Guess which account a file came from by its name.
 *
 * Banks put the card number in the filename — Chase4838_Activity_20260805.csv — so a payment method
 * whose last four appears there is almost certainly the right one. Only a guess: it is pre-selected,
 * not forced.
 */
function guessPaymentMethod(filename: string, methods: PaymentMethod[]): string {
  const match = methods.find((m) => m.last_four && filename.includes(m.last_four));
  return match ? String(match.id) : "";
}

export function TransactionImportModal({ budgetPk, paymentMethods, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [undone, setUndone] = useState(false);

  const url = `/budgets/${budgetPk}/transactions/import/`;

  // FormData rather than jsonFetch: this posts a file, so the browser has to set the multipart
  // boundary itself. Content-Type is deliberately not set for that reason.
  async function post(chosen: File, opts: { commit?: boolean; mapping?: Mapping } = {}) {
    const body = new FormData();
    body.append("file", chosen);
    if (opts.mapping) body.append("mapping", JSON.stringify(opts.mapping));
    if (method) body.append("payment_method", method);
    if (opts.commit) body.append("commit", "1");
    const res = await fetch(url, { method: "POST", headers: { "X-CSRFToken": getCsrfToken() }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errors = (data as { errors?: Record<string, string[]> }).errors ?? {};
      throw new Error(Object.values(errors).flat().join(" ") || "That file could not be read.");
    }
    return data;
  }

  async function handleFile(chosen: File) {
    setFile(chosen);
    setError("");
    setResult(null);
    setBusy(true);
    if (!method) setMethod(guessPaymentMethod(chosen.name, paymentMethods));
    try {
      const data = (await post(chosen)) as Preview;
      setPreview(data);
      setMapping(data.mapping);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  /** Re-reads the file with a corrected mapping, so the preview always reflects what will be written. */
  async function remap(next: Mapping) {
    setMapping(next);
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = (await post(file, { mapping: next })) as Preview;
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That mapping does not work for this file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setResult((await post(file, { commit: true, mapping })) as Result);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Put the whole import back.
   *
   * Offered here because this is where the regret happens: the wrong file, or a mapping that was
   * wrong in a way the preview did not make obvious. Both want all of it gone, not a row at a time.
   * Transactions the import logged itself go with it; anything categorised through review since does
   * not, though that cannot have happened while this dialog has been open.
   */
  async function handleUndo() {
    if (!result?.batch) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/budgets/${budgetPk}/imports/${result.batch}/delete/`, {
        method: "DELETE",
        headers: { "X-CSRFToken": getCsrfToken() },
      });
      if (!res.ok) throw new Error("That import could not be undone.");
      setUndone(true);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That import could not be undone.");
    } finally {
      setBusy(false);
    }
  }

  const methodName = paymentMethods.find((m) => String(m.id) === method)?.name;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {result && undone ? (
            <p className="text-sm">
              That import has been put back. Nothing from it remains, so the same file can be uploaded again.
            </p>
          ) : result ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                <strong className="font-semibold">{result.created}</strong> added to Pending for review
                {result.logged > 0 && <> · {result.logged} logged outright</>}
                {result.duplicates > 0 && <> · {result.duplicates} already imported</>}.
              </p>
              {result.duplicates > 0 && (
                <p className="text-xs text-ink-quiet">
                  Rows you had already imported were skipped, so re-uploading an overlapping date range is safe.
                </p>
              )}
              {result.unmatched_cards.length > 0 && (
                <p className="text-xs text-ink-quiet">
                  No payment method matches card {result.unmatched_cards.join(", ")}, so those rows arrived
                  {methodName ? ` on ${methodName}` : " without an account"}. Set that card's last four on a payment
                  method and re-import to split them out.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-file">A CSV from your bank, or a Budgeteer export</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void handleFile(chosen);
                  }}
                />
                <small className="text-muted-foreground">
                  Only a date and an amount are needed. Anything else it finds is used; anything it gets wrong you can
                  correct below before importing.
                </small>
              </div>

              {preview && (
                <>
                  <div className="rounded-md border border-border-strong bg-card p-3">
                    <p className="text-sm">
                      <strong className="font-semibold">{preview.row_count}</strong> rows · {preview.outflow_count} out
                      · {preview.inflow_count} in
                      {preview.cards.length > 0 && <> · cards {preview.cards.join(", ")}</>}
                    </p>
                    {preview.skipped.length > 0 && (
                      <p className="mt-1 text-xs text-alarm">
                        {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"} could not be read:{" "}
                        {preview.skipped
                          .slice(0, 3)
                          .map((s) => `line ${s.line} (${s.reason})`)
                          .join(", ")}
                        {preview.skipped.length > 3 && " …"}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {ROLES.map((role) => (
                      <div key={role.key} className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-normal text-ink-quiet">
                          {role.label}
                          {role.required && <span className="text-alarm"> *</span>}
                        </Label>
                        <Select
                          value={mapping[role.key] === null ? "none" : String(mapping[role.key])}
                          onValueChange={(v) => void remap({ ...mapping, [role.key]: v === "none" ? null : Number(v) })}
                        >
                          <SelectTrigger size="sm" className="w-[52%]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not in this file</SelectItem>
                            {preview.header.map((name, index) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: a column's position in the file is its identity here, since that index is exactly what the mapping records, and two columns can share a name or have none
                              <SelectItem key={index} value={String(index)}>
                                {name || `Column ${index + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>

                  {/* The first rows as they would be read. Cheaper to scan than the mapping above,
                      and it is where a wrong date format or a flipped sign shows up immediately. */}
                  <div className="overflow-x-auto rounded-md border border-border-strong">
                    <table className="w-full text-xs">
                      <thead className="bg-moss-soft">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Description</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Amount</th>
                          <th className="px-2 py-1.5 text-left font-semibold">In / out</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sample.map((row) => (
                          <tr key={row.line} className="border-t">
                            <td className="px-2 py-1 tabular-nums">{row.date}</td>
                            <td className="px-2 py-1">
                              {row.description || <span className="text-ink-quiet">—</span>}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{row.amount}</td>
                            <td className={`px-2 py-1 ${row.direction === "in" ? "text-income" : "text-expense"}`}>
                              {row.direction === "in" ? "in" : "out"}
                            </td>
                            <td className="px-2 py-1">{row.category || <span className="text-ink-quiet">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="import-method">Which account did these come from? (optional)</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger id="import-method">
                        <SelectValue placeholder="Choose an account" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((pm) => (
                          <SelectItem key={pm.id} value={String(pm.id)}>
                            {pm.name}
                            {pm.last_four && ` (${pm.last_four})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <small className="text-muted-foreground">
                      {preview.unmatched_cards.length > 0
                        ? `Card ${preview.unmatched_cards.join(", ")} in this file matches no payment method. Those rows will use the account above, or arrive without one if you leave this blank.`
                        : "Leave this blank if the file covers more than one account. Rows arrive in Pending either way, and you can fill in the account there before logging them."}
                    </small>
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {result ? "Done" : "Cancel"}
          </Button>
          {result && !undone && (
            <Button type="button" variant="destructive" onClick={() => void handleUndo()} disabled={busy}>
              {busy ? "Undoing…" : "Undo this import"}
            </Button>
          )}
          {!result && (
            <Button type="button" onClick={() => void handleImport()} disabled={busy || !preview}>
              <Upload aria-hidden className="size-4" />
              {busy ? "Reading…" : `Import ${preview?.row_count ?? 0} rows`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
