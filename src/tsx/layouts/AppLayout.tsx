import { router, usePage } from "@inertiajs/react";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import ThemeToggle from "../components/ThemeToggle";
import { startFullTour } from "../lib/onboardingTour";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  gravatar: string;
  is_staff: boolean;
  currency_code: string;
  currency_symbol: string;
}

interface PageProps {
  auth?: { user: AuthUser };
  current_budget?: { pk: number; name: string } | null;
  budget_pk?: number;
  month?: string;
  has_investments?: boolean;
}

function NavLink({
  href,
  active,
  children,
  useInertia = true,
  dataTour,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  useInertia?: boolean;
  dataTour?: string;
}) {
  return (
    <a
      className={`sidebar-link${active ? " active" : ""}`}
      href={href}
      data-tour={dataTour}
      onClick={
        useInertia
          ? (e) => {
              e.preventDefault();
              router.visit(href);
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

function logout() {
  void fetch("/accounts/logout/", {
    method: "POST",
    headers: { "X-CSRFToken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "" },
  }).then(() => router.visit("/accounts/login/"));
}

function UserMenu({ user, budgetPk }: { user: AuthUser; budgetPk?: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="sidebar-user" type="button" data-tour="account">
          <span className="shrink-0">
            <img src={user.gravatar} alt={user.name} width="26" height="26" className="rounded-full" />
          </span>
          <span className="sidebar-user-name">{user.email}</span>
          <span className="sidebar-user-chevron">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onClick={() => router.visit("/budgets/")}>My Budgets</DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.visit("/accounts/history/")}>Budget History</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.visit("/accounts/settings/")}>Account Settings</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTimeout(() => startFullTour(budgetPk), 50)}>Replay tour</DropdownMenuItem>
        {user.is_staff && (
          <DropdownMenuItem asChild>
            <a href="/admin/">Administration</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>Sign Out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { props, url } = usePage<PageProps>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = props.auth?.user;
  const sidebarBudget = props.current_budget ?? null;
  const sidebarBudgetPk = props.budget_pk ?? sidebarBudget?.pk;
  const month = props.month;

  const path = url.includes("://") ? new URL(url).pathname : url.split("?")[0];
  const isAt = (prefix: string) => path.startsWith(prefix);
  const txnHref = `/budgets/${sidebarBudgetPk}/transactions/?month=${month ?? ""}`;

  return (
    <div className="flex min-h-screen">
      <Toaster position="bottom-right" richColors closeButton />
      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className="sidebar fixed lg:static inset-y-0 left-0 z-50 lg:z-auto"
        data-sidebar-open={sidebarOpen || undefined}
      >
        <style>{`
          @media (max-width: 1023px) {
            [data-sidebar-open] { transform: translateX(0) !important; }
            .sidebar:not([data-sidebar-open]) { transform: translateX(-100%); }
          }
        `}</style>

        {/* Brand */}
        <div className="sidebar-brand-wrap">
          <a href="/" className="sidebar-brand">
            <img
              src="/public/static/concept_images/piggy/white/filled.png"
              alt=""
              width="28"
              height="28"
              className="block dark:hidden"
            />
            <img
              src="/public/static/concept_images/piggy/black/filled.png"
              alt=""
              width="28"
              height="28"
              className="hidden dark:block"
            />
            Budgeteer
          </a>
          <ThemeToggle className="text-[var(--moss-foreground)] hover:text-[var(--moss-foreground)] hover:bg-[color-mix(in_oklch,var(--moss-foreground)_12%,transparent)] dark:hover:bg-[color-mix(in_oklch,var(--moss-foreground)_12%,transparent)]" />
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {user ? (
            <>
              {sidebarBudgetPk ? (
                <div className="sidebar-group">
                  <span className="sidebar-group-label">Budgets</span>
                  <a
                    href="/budgets/"
                    data-tour="budget"
                    onClick={(e) => {
                      e.preventDefault();
                      router.visit("/budgets/");
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 mb-1 rounded-md text-sm font-medium text-ink hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                    title={`${sidebarBudget?.name ?? "Budget"} — switch budget`}
                  >
                    <span className="truncate">{sidebarBudget?.name || "Current Budget"}</span>
                    <span aria-hidden className="text-ink-quiet text-xs shrink-0">
                      ▾
                    </span>
                  </a>
                  <NavLink
                    href={`/budgets/${sidebarBudgetPk}/`}
                    active={path === `/budgets/${sidebarBudgetPk}/` || path === `/budgets/${sidebarBudgetPk}`}
                    dataTour="dashboard"
                  >
                    Dashboard
                  </NavLink>
                  <NavLink
                    href={txnHref}
                    active={isAt(`/budgets/${sidebarBudgetPk}/transactions`)}
                    dataTour="transactions"
                  >
                    Transactions
                  </NavLink>
                  <NavLink
                    href={`/budgets/${sidebarBudgetPk}/goals/`}
                    active={isAt(`/budgets/${sidebarBudgetPk}/goals`)}
                    dataTour="goals"
                  >
                    Goals
                  </NavLink>
                  <NavLink
                    href={`/budgets/${sidebarBudgetPk}/settings/`}
                    active={isAt(`/budgets/${sidebarBudgetPk}/settings`)}
                    dataTour="settings"
                  >
                    Settings
                  </NavLink>
                </div>
              ) : (
                <div className="sidebar-group">
                  <span className="sidebar-group-label">Budgets</span>
                  <NavLink href="/budgets/" active>
                    My Budgets
                  </NavLink>
                </div>
              )}
              <div className="sidebar-group">
                <span className="sidebar-group-label">Accounts</span>
                <NavLink href="/banking/" active={isAt("/banking")} dataTour="banking">
                  Banking
                </NavLink>
                {props.has_investments && (
                  <NavLink href="/investments/" active={isAt("/investments")}>
                    Investments
                  </NavLink>
                )}
              </div>
            </>
          ) : (
            <div className="sidebar-group">
              <NavLink href="/accounts/login/" useInertia={false}>
                Sign In
              </NavLink>
            </div>
          )}
        </nav>

        {/* Footer */}
        {user && (
          <div className="sidebar-footer">
            <UserMenu user={user} budgetPk={sidebarBudgetPk} />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col grow min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <header className="shrink-0 flex lg:hidden items-center border-b px-4 py-2 gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <a className="font-semibold no-underline text-foreground" href="/">
            Budgeteer
          </a>
        </header>

        <main className="grow flex flex-col p-4 lg:p-6">{children}</main>

        <footer className="shrink-0 border-t px-4 py-2">
          <p className="text-sm text-muted-foreground">© Budgeteer {new Date().getFullYear()}</p>
        </footer>
      </div>
    </div>
  );
}
