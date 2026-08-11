import {
  ArrowRight,
  GitBranch,
  Globe,
  LineChart,
  Moon,
  Repeat,
  Server,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "../components/ThemeToggle";

interface Props {
  github_url: string;
}

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  span: string;
}

const FEATURES: Feature[] = [
  {
    icon: Wallet,
    title: "Envelope budgeting",
    body: "Give every dollar a category and a monthly target. Categories can roll their balance forward, so a slow month funds the next one.",
    span: "md:col-span-3",
  },
  {
    icon: Repeat,
    title: "Recurring bills and paychecks",
    body: "Set up rent, subscriptions, and pay schedules once. Budgeteer projects the instances forward so you see what is coming before it lands.",
    span: "md:col-span-3",
  },
  {
    icon: Target,
    title: "Goals",
    body: "Save toward a one-time target or an ongoing fund, with the monthly amount worked out for you.",
    span: "md:col-span-2",
  },
  {
    icon: LineChart,
    title: "Live bank sync",
    body: "Pull posted transactions through SimpleFIN and reconcile them against your ledger with suggested matches.",
    span: "md:col-span-2",
  },
  {
    icon: Globe,
    title: "Multi-currency",
    body: "Log a transaction in any currency. Budgeteer keeps the rate it had that day and shows totals in yours.",
    span: "md:col-span-2",
  },
  {
    icon: Users,
    title: "Shared budgets",
    body: "Invite a partner or household member with owner or member roles, or keep several budgets side by side.",
    span: "md:col-span-3",
  },
  {
    icon: Moon,
    title: "Light and dark, both first-class",
    body: "Reviewed at a desk in the evening or glanced at in bed. Neither theme is an afterthought.",
    span: "md:col-span-3",
  },
];

function AppPreview() {
  // Illustrative sample only, not real data.
  const rows = [
    { name: "Groceries", spent: "420.00", target: "500.00", pct: 84 },
    { name: "Dining out", spent: "180.50", target: "200.00", pct: 90 },
    { name: "Transport", spent: "96.40", target: "160.00", pct: 60 },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-card">
      <div className="flex items-center gap-1.5 border-b border-rule px-4 py-3">
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="size-2.5 rounded-full bg-rule" />
        <span className="ml-3 text-xs text-ink-quiet">This month</span>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-ink-quiet">Earned</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-income">5,420.00</p>
          </div>
          <div>
            <p className="text-xs text-ink-quiet">Spent</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-expense">3,180.50</p>
          </div>
          <div>
            <p className="text-xs text-ink-quiet">Left to budget</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">2,239.50</p>
          </div>
        </div>
        <div className="mt-5 space-y-3 border-t border-rule pt-4">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="tabular-nums text-ink-quiet">
                  {r.spent} / {r.target}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong">
                <div className="h-full rounded-full bg-moss" style={{ width: `${r.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing({ github_url }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b border-rule bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <a href="/" className="flex items-center gap-2 no-underline text-foreground">
              <span className="grid size-7 place-items-center rounded-md bg-moss">
                <img src="/public/static/favicon2/favicon.svg" alt="" className="size-4.5 brightness-0 invert" />
              </span>
              <span className="text-lg font-semibold tracking-[-0.01em]">Budgeteer</span>
            </a>
            {/* Hidden below sm: the hero repeats it as a full "View on GitHub" button, and the six
                items together overflowed a 390px header by ~37px — which clipped the signup CTA, the
                one thing this page exists to offer. */}
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              aria-label="View on GitHub"
              className="hidden text-ink-quiet sm:inline-flex"
            >
              <a href={github_url} target="_blank" rel="noreferrer">
                <GitBranch />
              </a>
            </Button>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <a href="/accounts/login/">Sign in</a>
            </Button>
            <Button asChild size="sm">
              {/* "Sign up" on a phone, the fuller "Create account" once there is room for it. */}
              <a href="/accounts/signup/">
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Create account</span>
              </a>
            </Button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1100px] px-6 pt-20 pb-16">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-moss">
              Self-hosted budgeting
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-5xl">
              See where your money went, and where it is going.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-quiet">
              Budgeteer is a calm budgeting app you run yourself. Give every dollar a category, track recurring bills
              and paychecks, save toward goals, and sync your bank, all on your own server.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <a href="/accounts/signup/">
                  Create account
                  <ArrowRight />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={github_url} target="_blank" rel="noreferrer">
                  <GitBranch />
                  View on GitHub
                </a>
              </Button>
            </div>
          </div>
          <AppPreview />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-[1100px] px-6 py-16">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-moss">What it does</p>
        <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-[-0.01em]">
          Everything you need to run a budget, and nothing you do not.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-6">
          {FEATURES.map((f) => (
            <div key={f.title} className={`rounded-lg border border-rule bg-card p-6 ${f.span}`}>
              <span className="grid size-9 place-items-center rounded-md bg-moss-soft text-moss">
                <f.icon className="size-4.5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-quiet">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Self-hosted band */}
      <section className="mx-auto max-w-[1100px] px-6 py-16">
        <div className="rounded-xl border border-rule bg-moss-soft/40 px-8 py-12 md:px-12">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-moss">
                Your server, your data
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.01em]">Runs on Docker, backed by SimpleFIN.</h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-quiet">
                Budgeteer is a personal tool, not a service. Your financial data lives on the machine you deploy it to.
                Bank connections go through SimpleFIN rather than a data broker, and the whole thing is open source.
              </p>
              <div className="mt-6">
                <Button asChild variant="outline">
                  <a href={github_url} target="_blank" rel="noreferrer">
                    <GitBranch />
                    Read the source
                  </a>
                </Button>
              </div>
            </div>
            <ul className="space-y-4">
              {[
                { icon: Server, title: "One-command deploy", body: "Docker Compose with migrations on boot." },
                { icon: ShieldCheck, title: "Data stays with you", body: "No third-party dashboards, no data broker." },
                {
                  icon: LineChart,
                  title: "Live bank sync",
                  body: "SimpleFIN pulls posted transactions on a schedule.",
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-moss text-moss-foreground">
                    <item.icon className="size-4" />
                  </span>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-ink-quiet">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2 text-ink-quiet">
            <span className="grid size-5 place-items-center rounded bg-moss">
              <img src="/public/static/favicon2/favicon.svg" alt="" className="size-3.5 brightness-0 invert" />
            </span>
            <span className="text-sm">Budgeteer</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-ink-quiet">
            <a href="/accounts/login/" className="touch-target hover:text-foreground">
              Sign in
            </a>
            <a href="/accounts/signup/" className="touch-target hover:text-foreground">
              Create account
            </a>
            <a
              href={github_url}
              target="_blank"
              rel="noreferrer"
              className="touch-target flex items-center gap-1.5 hover:text-foreground"
            >
              <GitBranch className="size-4" />
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

Landing.layout = (page: React.ReactNode) => page;
