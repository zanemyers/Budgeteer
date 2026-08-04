import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The theme actually in effect, tracked from the `dark` class on `<html>`.
 *
 * That class is this app's single source of truth: the pre-paint script in app.html sets it
 * from localStorage, ThemeToggle rewrites it, and ThemeToggle's media-query listener
 * re-applies it when the OS flips while the preference is "auto". Observing the class picks up
 * all three without having to duplicate any of that logic.
 *
 * This replaces a `useTheme()` from next-themes, which had no provider anywhere in the app —
 * so it always returned "system" and toasts followed the OS rather than the chosen theme,
 * leaving light toasts on a dark page for anyone whose OS and app preference disagreed.
 */
function useEffectiveTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useEffectiveTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // richColors otherwise paints success/error from sonner's own palette, which is the
          // one place in the app where colour doesn't come from a token. Point them at the
          // semantic tokens instead so both themes stay on-brand.
          "--success-bg": "var(--moss-soft)",
          "--success-text": "var(--ink)",
          "--success-border": "var(--moss)",
          "--error-bg": "var(--expense-soft)",
          "--error-text": "var(--ink)",
          "--error-border": "var(--alarm)",
          "--warning-bg": "var(--fund-soft)",
          "--warning-text": "var(--ink)",
          "--warning-border": "var(--fund)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
