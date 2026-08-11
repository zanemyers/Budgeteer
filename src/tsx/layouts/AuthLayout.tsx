import { FlashToaster } from "../components/FlashToaster";
import ThemeToggle from "../components/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <FlashToaster />
      <div className="flex justify-between items-center px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
        <a href="/" className="touch-target font-semibold no-underline text-foreground text-lg">
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
