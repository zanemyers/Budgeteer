import { router, usePage } from "@inertiajs/react";
import { ChevronDown, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FlashToaster } from "@/components/FlashToaster";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCsrfToken } from "@/lib/api";
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
  // Inertia's usePage generic requires an index signature; page props are an open bag.
  [key: string]: unknown;
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

/**
 * Label for the mobile breadcrumb. Derived from the path rather than passed in per page, so a page
 * cannot forget to set one — and it stays in step with the sidebar, which decides "where am I" from
 * the same path. Budget-scoped routes are matched first: `/budgets/` alone is the budget list, but
 * `/budgets/1/goals` must not fall through to it.
 */
function pageNameFor(path: string, budgetPk?: number): string | null {
  if (budgetPk) {
    const base = `/budgets/${budgetPk}`;
    if (path === base || path === `${base}/`) return "Dashboard";
    if (path.startsWith(`${base}/transactions`)) return "Transactions";
    if (path.startsWith(`${base}/goals`)) return "Goals";
    if (path.startsWith(`${base}/settings`)) return "Settings";
  }
  if (path.startsWith("/banking")) return "Banking";
  if (path.startsWith("/investments")) return "Investments";
  if (path.startsWith("/accounts/settings")) return "Account";
  if (path.startsWith("/accounts/history")) return "History";
  if (path === "/budgets" || path === "/budgets/") return "My Budgets";
  return null;
}

async function logout() {
  try {
    await fetch("/accounts/logout/", {
      method: "POST",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
  } catch {
    // Fall through to the redirect regardless: the session may already be gone, and leaving
    // the user on an authenticated-looking page is worse than an extra bounce through login.
  }
  router.visit("/accounts/login/");
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
          <ChevronDown aria-hidden className="sidebar-user-chevron size-3.5" />
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
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const user = props.auth?.user;

  // Close the drawer on any Inertia visit. AppLayout is the persistent layout, so this state
  // survives navigation — without this, tapping a nav link loaded the next page *behind* a
  // still-open drawer and the user had to dismiss it by hand.
  useEffect(() => router.on("start", () => setSidebarOpen(false)), []);

  // Below lg the drawer is a modal, so it needs the three things a modal owes the user: the page
  // behind it must not scroll away under the overlay, Tab must not walk into content that is
  // covered, and focus must come back to the button that opened it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const drawer = sidebarRef.current;
    const opener = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    drawer?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The user menu portals out to the body, so let it take Escape first — dismissing a
        // dropdown should not also tear down the drawer underneath it.
        if (document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"]')) return;
        setSidebarOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawer) return;
      const focusable = drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === drawer)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [sidebarOpen]);

  const sidebarBudget = props.current_budget ?? null;
  const sidebarBudgetPk = props.budget_pk ?? sidebarBudget?.pk;
  const month = props.month;

  const path = url.includes("://") ? new URL(url).pathname : url.split("?")[0];
  const isAt = (prefix: string) => path.startsWith(prefix);
  const txnHref = `/budgets/${sidebarBudgetPk}/transactions/?month=${month ?? ""}`;
  const pageName = pageNameFor(path, sidebarBudgetPk);

  return (
    <div className="flex min-h-dvh">
      <FlashToaster />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>
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
        id="app-sidebar"
        ref={sidebarRef}
        tabIndex={-1}
        // Only a dialog while it is acting as one: from lg up this is a static column, and
        // announcing a permanently-visible sidebar as a modal would be a lie. Spread as one unit
        // because the three attributes are only ever valid together.
        {...(sidebarOpen ? ({ role: "dialog", "aria-modal": true, "aria-label": "Navigation" } as const) : {})}
        className="sidebar fixed lg:static inset-y-0 left-0 z-50 lg:z-auto outline-none"
        data-sidebar-open={sidebarOpen || undefined}
      >
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
        <nav aria-label="Main" className="sidebar-nav">
          {user ? (
            <>
              {sidebarBudgetPk && (
                <div className="sidebar-group">
                  {/* Name is context only — switching budgets lives in the user menu. */}
                  <span className="sidebar-group-label truncate">{sidebarBudget?.name || "Current Budget"}</span>
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
      <div className="flex flex-col grow min-w-0 min-h-dvh">
        {/* Mobile top bar — sticky, because it holds the only route to navigation on a phone and
            scrolling a 500-row register would otherwise strand the user with no way back. */}
        <header className="sticky top-0 z-30 shrink-0 flex lg:hidden items-center border-b bg-background px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] gap-2">
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            <Menu />
          </Button>
          {/* The same two-image swap as the sidebar brand, but with the light/dark mapping reversed.
              The sidebar sits on moss in both themes, so it wants the white pig in light mode; this
              header is bg-background — white in light mode — so it needs the black one there. */}
          <a className="flex items-center gap-2 font-semibold no-underline text-foreground" href="/">
            <img
              src="/public/static/concept_images/piggy/black/filled.png"
              alt=""
              width="24"
              height="24"
              className="block dark:hidden"
            />
            <img
              src="/public/static/concept_images/piggy/white/filled.png"
              alt=""
              width="24"
              height="24"
              className="hidden dark:block"
            />
            Budgeteer
          </a>
          {/* Wayfinding lives in the shell, not in the content: the pages no longer repeat their own
              name, and below lg the sidebar is a closed drawer, so this is the only thing on screen
              saying where you are. Deliberately quieter than the brand — it is a label, not a title. */}
          {pageName && (
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink-quiet">
              <span aria-hidden="true">›</span>
              <span className="truncate">{pageName}</span>
            </span>
          )}
        </header>

        <main id="main" className="grow flex flex-col p-4 lg:p-6">
          {children}
        </main>

        <footer className="shrink-0 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <p className="text-sm text-muted-foreground">© Budgeteer {new Date().getFullYear()}</p>
        </footer>
      </div>
    </div>
  );
}
