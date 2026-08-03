import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Theme = "auto" | "light" | "dark";

const cycle: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };

function applyTheme(theme: Theme) {
  const effective =
    theme === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  if (effective === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("theme") as Theme | null) ?? "auto");
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function toggle() {
    const next = cycle[theme];
    localStorage.setItem("theme", next);
    setTheme(next);
    setSpinning(true);
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label =
    theme === "light" ? "Switch to dark theme" : theme === "dark" ? "Switch to auto theme" : "Switch to light theme";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={toggle}
      onAnimationEnd={() => setSpinning(false)}
      className={`${spinning ? "[&>svg]:animate-[spin_300ms_ease-out]" : ""} ${className}`}
    >
      <Icon />
    </Button>
  );
}
