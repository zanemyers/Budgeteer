import { usePage, router } from "@inertiajs/react";
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { props, url } = usePage<PageProps>();
  const user = props.auth?.user;
  const budgetPk = props.budget_pk;
  const month = props.month;

  const path = url.includes("://") ? new URL(url).pathname : url.split("?")[0];
  const isAt = (prefix: string) => path.startsWith(prefix);
  const txnHref = `/budgets/${budgetPk}/transactions/?month=${month ?? ""}`;

  return (
    <div className="d-flex h-100">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div
        className="offcanvas-lg offcanvas-start sidebar"
        id="sidebarNav"
        tabIndex={-1}
        aria-labelledby="sidebarNavLabel"
      >
        {/* Mobile header */}
        <div className="offcanvas-header sidebar-offcanvas-header d-lg-none">
          <span className="sidebar-brand d-flex align-items-center gap-2" id="sidebarNavLabel">
            Budgeteer
            <img src="/public/static/favicon.ico" alt="" width="16" height="16" />
          </span>
          <div className="d-flex align-items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="btn-close btn-close-white"
              data-bs-dismiss="offcanvas"
              data-bs-target="#sidebarNav"
              aria-label="Close"
            />
          </div>
        </div>

        <div className="offcanvas-body sidebar-body d-flex flex-column p-0">
          {/* Desktop brand */}
          <div className="sidebar-brand-wrap d-none d-lg-flex align-items-center justify-content-between">
            <a href="/" className="sidebar-brand d-flex align-items-center gap-2">
              <img src="/public/static/favicon.ico" alt="" width="32" height="32" />
              Budgeteer
            </a>
            <ThemeToggle />
          </div>

          {/* Nav */}
          <nav className="sidebar-nav flex-grow-1">
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
                      active={
                        path === `/budgets/${budgetPk}/` ||
                        path === `/budgets/${budgetPk}`
                      }
                    >
                      Dashboard
                    </NavLink>
                    <NavLink href={txnHref} active={isAt(`/budgets/${budgetPk}/transactions`)}>
                      All Transactions
                    </NavLink>
                    <NavLink
                      href={`/budgets/${budgetPk}/categories/`}
                      active={isAt(`/budgets/${budgetPk}/categories`)}
                    >
                      Categories
                    </NavLink>
                    <NavLink
                      href={`/budgets/${budgetPk}/sinking-funds/`}
                      active={isAt(`/budgets/${budgetPk}/sinking-funds`)}
                    >
                      Sinking Funds
                    </NavLink>
                    <NavLink
                      href={`/budgets/${budgetPk}/recurring/`}
                      active={isAt(`/budgets/${budgetPk}/recurring`)}
                    >
                      Recurring
                    </NavLink>
                    <NavLink
                      href={`/budgets/${budgetPk}/payment-methods/`}
                      active={isAt(`/budgets/${budgetPk}/payment-methods`)}
                    >
                      Payment Methods
                    </NavLink>
                    <NavLink
                      href={`/budgets/${budgetPk}/members/`}
                      active={isAt(`/budgets/${budgetPk}/members`)}
                    >
                      Members
                    </NavLink>
                  </div>
                )}
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
              <div className="dropdown">
                <button
                  className="sidebar-user dropdown-toggle"
                  type="button"
                  data-bs-toggle="dropdown"
                  aria-expanded="false"
                >
                  <span className="sidebar-user-avatar">
                    <img
                      src={user.gravatar}
                      alt={user.name}
                      width="26"
                      height="26"
                      className="rounded-circle"
                    />
                  </span>
                  <span className="sidebar-user-name">{user.email}</span>
                </button>
                <ul className="dropdown-menu">
                  <li>
                    <a className="dropdown-item" href="/accounts/settings/">
                      Account Settings
                    </a>
                  </li>
                  {user.is_staff && (
                    <li>
                      <a className="dropdown-item" href="/admin/">
                        Administration
                      </a>
                    </li>
                  )}
                  <li>
                    <button type="button" className="dropdown-item" onClick={logout}>Sign Out</button>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────── */}
      <div className="d-flex flex-column flex-grow-1 overflow-hidden">
        {/* Mobile top bar */}
        <header className="d-flex d-lg-none align-items-center border-bottom px-3 py-2 gap-2">
          <button
            className="btn btn-sm p-1"
            type="button"
            data-bs-toggle="offcanvas"
            data-bs-target="#sidebarNav"
            aria-controls="sidebarNav"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>
          <a className="navbar-brand mb-0 fw-semibold" href="/">
            Budgeteer
          </a>
        </header>

        <main className="flex-grow-1 p-4 overflow-y-auto">{children}</main>

        <footer className="footer container-fluid border-top pt-2 pb-2">
          <p className="small text-secondary mb-0">
            © Budgeteer {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </div>
  );
}
