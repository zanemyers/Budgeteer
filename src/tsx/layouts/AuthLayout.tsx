import ThemeToggle from "../components/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-4 pt-4 pb-2">
        <a href="/" className="font-semibold no-underline text-foreground text-lg">
          Budgeteer
        </a>
        <ThemeToggle />
      </div>
      <div className="grow flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
