import { usePage, router } from "@inertiajs/react";
import { useState, useRef, useEffect } from "react";
import ThemeToggle from "../components/ThemeToggle";

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

function logout(e: React.MouseEvent) {
  e.preventDefault();
  void fetch("/accounts/logout/", {
    method: "POST",
    headers: { "X-CSRFToken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "" },
  }).then(() => router.visit("/accounts/login/"));
}

function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="sidebar-user"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="shrink-0">
          <img src={user.gravatar} alt={user.name} width="26" height="26" className="rounded-full" />
        </span>
        <span className="sidebar-user-name">{user.email}</span>
        <span className="sidebar-user-chevron">▾</span>
      </button>

      {open && (
        <ul
          className="dropdown-menu"
          style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0 }}
        >
          <li>
            <a className="dropdown-item" href="/accounts/settings/" onClick={(e) => { e.preventDefault(); setOpen(false); router.visit("/accounts/settings/"); }}>
              Account Settings
            </a>
          </li>
          {user.is_staff && (
            <li>
              <a className="dropdown-item" href="/admin/">Administration</a>
            </li>
          )}
          <li>
            <button type="button" className="dropdown-item" onClick={(e) => { setOpen(false); logout(e); }}>
              Sign Out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { props, url } = usePage<PageProps>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = props.auth?.user;
  const budgetPk = props.budget_pk;
  const month = props.month;

  const path = url.includes("://") ? new URL(url).pathname : url.split("?")[0];
  const isAt = (prefix: string) => path.startsWith(prefix);
  const txnHref = `/budgets/${budgetPk}/transactions/?month=${month ?? ""}`;

  return (
    <div className="flex h-full">
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
        style={{
          transform: sidebarOpen ? "translateX(0)" : undefined,
        }}
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
            <img src="/public/static/favicon.ico" alt="" width="28" height="28" />
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
                <NavLink href="/budgets/" active={isAt("/budgets/") && !budgetPk}>
                  My Budgets
                </NavLink>
                <NavLink href="/accounts/history/" active={isAt("/accounts/history")}>
                  History
                </NavLink>
              </div>

              {budgetPk && (
                <div className="sidebar-group">
                  <span className="sidebar-group-label">Current Budget</span>
                  <NavLink
                    href={`/budgets/${budgetPk}/`}
                    active={path === `/budgets/${budgetPk}/` || path === `/budgets/${budgetPk}`}
                  >
                    Dashboard
                  </NavLink>
                  <NavLink href={txnHref} active={isAt(`/budgets/${budgetPk}/transactions`)}>
                    All Transactions
                  </NavLink>
                  <NavLink href={`/budgets/${budgetPk}/categories/`} active={isAt(`/budgets/${budgetPk}/categories`)}>
                    Categories
                  </NavLink>
                  <NavLink href={`/budgets/${budgetPk}/sinking-funds/`} active={isAt(`/budgets/${budgetPk}/sinking-funds`)}>
                    Sinking Funds
                  </NavLink>
                  <NavLink href={`/budgets/${budgetPk}/recurring/`} active={isAt(`/budgets/${budgetPk}/recurring`)}>
                    Recurring
                  </NavLink>
                  <NavLink href={`/budgets/${budgetPk}/payment-methods/`} active={isAt(`/budgets/${budgetPk}/payment-methods`)}>
                    Payment Methods
                  </NavLink>
                  <NavLink href={`/budgets/${budgetPk}/members/`} active={isAt(`/budgets/${budgetPk}/members`)}>
                    Members
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
      <div className="flex flex-col grow overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex lg:hidden items-center border-bottom px-4 py-2 gap-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
            </svg>
          </button>
          <a className="font-semibold no-underline text-body" href="/">Budgeteer</a>
        </header>

        <main className="grow p-4 overflow-y-auto lg:p-6">{children}</main>

        <footer className="footer border-top px-4 py-2">
          <p className="text-sm text-secondary mb-0">
            © Budgeteer {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </div>
  );
}
