import { usePage } from "@inertiajs/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

interface FlashProps {
  flash?: Array<{ level: string; message: string }>;
  // Inertia's usePage generic requires an index signature; page props are an open bag.
  [key: string]: unknown;
}

/**
 * Mounts the toast surface and raises any server-side `flash` messages through it.
 *
 * Lives in both layouts. AuthLayout previously had no Toaster at all, so toasts raised from
 * the sign-in and confirmation screens rendered nowhere, and Django messages set during an
 * allauth flow had no way to reach the user even once the middleware started sharing them
 * for anonymous requests.
 */
export function FlashToaster() {
  const { props } = usePage<FlashProps>();
  const flash = props.flash;

  useEffect(() => {
    for (const { level, message } of flash ?? []) {
      if (level === "error") toast.error(message);
      else if (level === "warning") toast.warning(message);
      else if (level === "success") toast.success(message);
      else toast(message);
    }
    // Keyed on the messages themselves: a re-render must not re-toast, but a navigation
    // carrying new ones must.
  }, [flash]);

  return <Toaster position="bottom-right" richColors closeButton />;
}
