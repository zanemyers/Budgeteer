import { useState } from "react";
import { router } from "@inertiajs/react";

interface BudgetEntry {
  id: number;
  name: string;
  months: string[];
}

interface Props {
  budgets: BudgetEntry[];
}

function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleString("default", { month: "long" });
}

function groupByYear(months: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const m of months) {
    const year = m.split("-")[0];
    (grouped[year] ??= []).push(m);
  }
  return grouped;
}

function BudgetCard({ budget }: { budget: BudgetEntry }) {
  const [open, setOpen] = useState(false);
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const byYear = groupByYear(budget.months);
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="card">
      <button
        type="button"
        className="card-header flex justify-between items-center border-0 bg-transparent w-full text-left"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold">{budget.name}</span>
        <span className="text-muted text-sm" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>
          ▾
        </span>
      </button>

      {open && (
        <div className="card-body p-0">
          {budget.months.length === 0 ? (
            <p className="text-muted text-sm p-4 mb-0">No transactions yet.</p>
          ) : (
            <div>
              {years.map((year) => (
                <div key={year} className="border-top">
                  <button
                    type="button"
                    className="flex justify-between items-center w-full text-left px-4 py-2 bg-transparent border-0"
                    style={{ cursor: "pointer" }}
                    onClick={() => setExpandedYear(expandedYear === year ? null : year)}
                  >
                    <span className="font-semibold">{year}</span>
                    <span className="text-muted text-sm" style={{ transform: expandedYear === year ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>
                      ▾
                    </span>
                  </button>

                  {expandedYear === year && (
                    <div className="flex flex-wrap gap-2 px-4 pb-4">
                      {byYear[year].map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => router.visit(`/budgets/${budget.id}/transactions/?month=${m}`)}
                        >
                          {formatMonth(m)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BudgetHistory({ budgets }: Props) {
  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="mb-6">Budget History</h1>

      {budgets.length === 0 ? (
        <p className="text-muted">
          No budgets found.{" "}
          <a href="/budgets/" onClick={(e) => { e.preventDefault(); router.visit("/budgets/"); }}>
            Create one
          </a>{" "}
          to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} />
          ))}
        </div>
      )}
    </div>
  );
}
