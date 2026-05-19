import { usePage, router } from "@inertiajs/react";
import { useState } from "react";
import { Menu } from "lucide-react";
import ThemeToggle from "../components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
}

function NavLink({
  href,
  active,
  children,
  useInertia = true,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  useInertia?: boolean;
}) {
  return (
    <a
      className={`sidebar-link${active ? " active" : ""}`}
      href={href}
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

function UserMenu({ user }: { user: AuthUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="sidebar-user" type="button">
          <span className="shrink-0">
            <img src={user.gravatar} alt={user.name} width="26" height="26" className="rounded-full" />
          </span>
          <span className="sidebar-user-name">{user.email}</span>
          <span className="sidebar-user-chevron">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onClick={() => router.visit("/accounts/settings/")}>
          Account Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.visit("/accounts/history/")}>
          Budget History
        </DropdownMenuItem>
        {user.is_staff && (
          <DropdownMenuItem asChild>
            <a href="/admin/">Administration</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          Sign Out
        </DropdownMenuItem>
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
  const onCurrentBudget = props.budget_pk != null;

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
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
          <ThemeToggle />
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {user ? (
            <>
              <div className="sidebar-group">
                <span className="sidebar-group-label">Budgets</span>
                <NavLink href="/budgets/" active={isAt("/budgets/") && !onCurrentBudget}>
                  My Budgets
                </NavLink>
                <NavLink href="/banking/" active={isAt("/banking")}>
                  Banking
                </NavLink>
              </div>

              {sidebarBudgetPk && (
                <div className="sidebar-group">
                  <span className="sidebar-group-label" title={sidebarBudget?.name ?? undefined}>
                    {sidebarBudget?.name || "Current Budget"}
                  </span>
                  <NavLink
                    href={`/budgets/${sidebarBudgetPk}/`}
                    active={path === `/budgets/${sidebarBudgetPk}/` || path === `/budgets/${sidebarBudgetPk}`}
                  >
                    Dashboard
                  </NavLink>
                  <NavLink href={txnHref} active={isAt(`/budgets/${sidebarBudgetPk}/transactions`)}>
                    Transactions
                  </NavLink>
                  <NavLink href={`/budgets/${sidebarBudgetPk}/sinking-funds/`} active={isAt(`/budgets/${sidebarBudgetPk}/sinking-funds`)}>
                    Goals
                  </NavLink>
                  <NavLink href={`/budgets/${sidebarBudgetPk}/settings/`} active={isAt(`/budgets/${sidebarBudgetPk}/settings`)}>
                    Settings
                  </NavLink>
                </div>
              )}
            </>
          ) : (
            <div className="sidebar-group">
              <NavLink href="/accounts/login/" useInertia={false}>Sign In</NavLink>
            </div>
          )}
        </nav>

        {/* Footer */}
        {user && (
          <div className="sidebar-footer">
            <UserMenu user={user} />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col grow min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <header className="shrink-0 flex lg:hidden items-center border-b px-4 py-2 gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <a className="font-semibold no-underline text-foreground" href="/">Budgeteer</a>
        </header>

        <main className="grow flex flex-col p-4 lg:p-6">{children}</main>

        <footer className="shrink-0 border-t px-4 py-2">
          <p className="text-sm text-muted-foreground">
            © Budgeteer {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </div>
  );
}
