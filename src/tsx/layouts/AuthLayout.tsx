import ThemeToggle from "../components/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-vh-100 d-flex flex-column">
      <div className="d-flex justify-content-between align-items-center px-4 pt-3 pb-2">
        <a href="/" className="fw-semibold text-decoration-none text-body" style={{ fontSize: "1.1rem" }}>
          Budgeteer
        </a>
        <ThemeToggle />
      </div>
      <div className="flex-grow-1 d-flex align-items-center justify-content-center px-3 py-5">
        <div style={{ width: "100%", maxWidth: 400 }}>{children}</div>
      </div>
    </div>
  );
}
