import { router } from "@inertiajs/react";

interface BudgetEntry {
  id: number;
  name: string;
  months: string[];
  is_default?: boolean;
}

interface Props {
  budgets: BudgetEntry[];
}

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function groupByYear(months: string[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    if (!map.has(y)) map.set(y, new Set());
    map.get(y)!.add(mo);
  }
  return new Map([...map.entries()].sort(([a], [b]) => b - a));
}

function YearStrip({ budgetId, year, activeMonths }: { budgetId: number; year: number; activeMonths: Set<number> }) {
  const count = activeMonths.size;
  return (
    <div className="archive-year">
      <div className="archive-year-head">
        <h3 className="archive-year-num">{year}</h3>
        <span className="archive-year-rule" aria-hidden />
        <span className="archive-year-meta">
          {count} {count === 1 ? "entry" : "entries"}
        </span>
      </div>
      <div className="archive-year-grid">
        {Array.from({ length: 12 }).map((_, idx) => {
          const monthIdx = idx + 1;
          const isActive = activeMonths.has(monthIdx);
          const monthStr = `${year}-${String(monthIdx).padStart(2, "0")}`;
          if (!isActive) {
            return (
              <div key={monthStr} className="archive-month archive-month--empty" aria-hidden>
                <span>{MONTH_ABBR[idx]}</span>
              </div>
            );
          }
          return (
            <button
              key={monthStr}
              type="button"
              className="archive-month archive-month--active"
              onClick={() => router.visit(`/budgets/${budgetId}/transactions/?month=${monthStr}`)}
              title={`${MONTH_ABBR[idx]} ${year} — open ledger`}
            >
              <span>{MONTH_ABBR[idx]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BudgetSection({ budget, index }: { budget: BudgetEntry; index: number }) {
  const years = groupByYear(budget.months);
  const yearCount = years.size;
  const monthCount = budget.months.length;

  return (
    <article className="archive-budget" style={{ animationDelay: `${index * 90}ms` }}>
      <header className="archive-budget-head">
        <div className="archive-folio-row">
          <span className="archive-folio">№ {String(index + 1).padStart(2, "0")}</span>
          <span className="archive-folio-rule" aria-hidden />
          {budget.is_default && <span className="archive-default-tag">Default</span>}
        </div>
        <h2 className="archive-title">{budget.name}</h2>
        <p className="archive-meta">
          {monthCount} {monthCount === 1 ? "month" : "months"}
          <span className="archive-dot" aria-hidden>
            ·
          </span>
          {yearCount} {yearCount === 1 ? "year" : "years"} of records
        </p>
      </header>

      {budget.months.length === 0 ? (
        <p className="archive-empty">
          <em>No entries yet.</em> Open this budget and post your first transaction.
        </p>
      ) : (
        <div className="archive-years">
          {[...years.entries()].map(([year, activeMonths]) => (
            <YearStrip key={year} budgetId={budget.id} year={year} activeMonths={activeMonths} />
          ))}
        </div>
      )}
    </article>
  );
}

export default function BudgetHistory({ budgets }: Props) {
  return (
    <>
      <style>{`
        .archive {
          --rule: var(--border-strong);
          --grid-gap: 0.375rem;
          font-family: "DM Sans", system-ui, -apple-system, sans-serif;
          padding: 0.5rem 0 5rem;
          max-width: 56rem;
          margin: 0 auto;
        }

        .archive-hero {
          padding: 0.5rem 0 1.5rem;
        }

        .archive-eyebrow {
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.6875rem;
          font-weight: 500;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--primary);
          margin-bottom: 1rem;
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
        }
        .archive-eyebrow::before {
          content: '';
          width: 1.75rem;
          height: 1px;
          background: currentColor;
          opacity: 0.6;
        }

        .archive-headline {
          font-family: "DM Sans", system-ui, sans-serif;
          font-size: clamp(2rem, 5vw, 3rem);
          font-weight: 600;
          line-height: 1.05;
          letter-spacing: -0.035em;
          color: var(--foreground);
          margin: 0 0 1rem;
        }
        .archive-headline em {
          font-style: normal;
          font-weight: 600;
          color: var(--primary);
        }

        .archive-subhead {
          max-width: 50ch;
          font-size: 0.9375rem;
          line-height: 1.55;
          color: var(--muted-foreground);
        }

        .archive-empty-page {
          font-size: 0.9375rem;
          color: var(--muted-foreground);
        }
        .archive-empty-page em { font-style: normal; font-weight: 600; color: var(--foreground); }

        /* Per-budget chapter */
        .archive-budget {
          padding: 1.75rem 0 2rem;
          opacity: 0;
          animation: archive-rise 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
        }
        .archive-budget:last-child { padding-bottom: 0; }

        @keyframes archive-rise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .archive-budget-head { margin-bottom: 1.75rem; }

        .archive-folio-row {
          display: flex;
          align-items: center;
          gap: 0.875rem;
          margin-bottom: 0.625rem;
        }
        .archive-folio {
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.6875rem;
          font-weight: 500;
          letter-spacing: 0.18em;
          color: var(--muted-foreground);
        }
        .archive-folio-rule {
          flex: 1;
          height: 1px;
          background: var(--rule);
        }

        .archive-default-tag {
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.625rem;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--primary);
          background: color-mix(in oklab, var(--primary) 15%, transparent);
          padding: 0.2rem 0.45rem;
          border-radius: 2px;
        }

        .archive-title {
          font-family: "DM Sans", system-ui, sans-serif;
          font-size: clamp(1.5rem, 3vw, 1.875rem);
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: -0.025em;
          color: var(--foreground);
          margin: 0 0 0.4rem;
        }

        .archive-meta {
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          margin: 0;
        }
        .archive-dot { padding: 0 0.5rem; opacity: 0.6; }

        .archive-empty {
          font-size: 0.9375rem;
          color: var(--muted-foreground);
          padding: 0.5rem 0 0;
        }
        .archive-empty em { font-style: normal; font-weight: 600; color: var(--foreground); margin-right: 0.25rem; }

        /* Year strip */
        .archive-years { display: flex; flex-direction: column; gap: 1.5rem; }

        .archive-year-head {
          display: flex;
          align-items: baseline;
          gap: 0.875rem;
          margin-bottom: 0.625rem;
        }
        .archive-year-num {
          font-family: "DM Sans", system-ui, sans-serif;
          font-size: 1.5rem;
          font-weight: 600;
          line-height: 1;
          letter-spacing: -0.03em;
          color: var(--foreground);
          font-feature-settings: "tnum";
          margin: 0;
        }
        .archive-year-rule {
          flex: 1;
          height: 1px;
          background: var(--rule);
          align-self: end;
          margin-bottom: 0.4rem;
        }
        .archive-year-meta {
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.6875rem;
          font-weight: 500;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }

        .archive-year-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: var(--grid-gap);
        }
        @media (min-width: 640px) {
          .archive-year-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
        }

        .archive-month {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 2.625rem;
          padding: 0;
          font-family: "DM Mono", ui-monospace, monospace;
          font-size: 0.7rem;
          font-weight: 500;
          letter-spacing: 0.18em;
          border-radius: 4px;
          transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.3, 1),
                      box-shadow 0.25s cubic-bezier(0.2, 0.7, 0.3, 1),
                      background 0.2s ease,
                      color 0.2s ease;
          will-change: transform;
        }

        .archive-month--active {
          color: var(--primary-foreground);
          background: var(--primary);
          border: 1px solid var(--primary);
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .archive-month--active::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%);
          transform: translateX(-100%);
          transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
        }
        .archive-month--active:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 14px -4px color-mix(in oklab, var(--primary) 45%, transparent);
        }
        .archive-month--active:hover::before { transform: translateX(100%); }
        .archive-month--active:active { transform: translateY(0); }
        .archive-month--active:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        .archive-month--empty {
          color: var(--muted-foreground);
          background: transparent;
          border: 1px dashed var(--rule);
          opacity: 0.45;
        }
      `}</style>

      <div className="archive">
        <header className="archive-hero">
          <p className="archive-eyebrow">The Archive</p>
          <h1 className="archive-headline">
            Every month, <em>shelved.</em>
          </h1>
          <p className="archive-subhead">
            A chronicle of every budget you've kept. Each tile is a month with transactions — click one to revisit its
            ledger.
          </p>
        </header>

        {budgets.length === 0 ? (
          <p className="archive-empty-page">
            <em>No budgets yet.</em>{" "}
            <a
              href="/budgets/"
              className="text-primary hover:underline"
              onClick={(e) => {
                e.preventDefault();
                router.visit("/budgets/");
              }}
            >
              Start one
            </a>{" "}
            and we'll keep the records.
          </p>
        ) : (
          <div>
            {budgets.map((b, i) => (
              <BudgetSection key={b.id} budget={b} index={i} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
