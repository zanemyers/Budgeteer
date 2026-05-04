import ThemeToggle from "../components/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-4 pt-4 pb-2">
        <a href="/" className="font-semibold no-underline text-body" style={{ fontSize: "1.1rem" }}>
          Budgeteer
        </a>
        <ThemeToggle />
      </div>
      <div className="grow flex items-center justify-center px-4 py-12">
        <div style={{ width: "100%", maxWidth: 400 }}>{children}</div>
      </div>
    </div>
  );
}
