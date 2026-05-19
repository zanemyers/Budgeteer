import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onConfirm: () => void | Promise<void>;
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
  disabled?: boolean;
}

const DURATION_MS = 350;

export function ConfirmButton({
  onConfirm,
  label = "Remove",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  size = "sm",
  className,
  disabled,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState<number | "auto">("auto");

  const removeRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Measure both states and set the container width to the active one. The
  // measurement happens synchronously after layout, so the first paint already
  // has the correct width — no flash. Subsequent state changes animate via
  // CSS width transition.
  useLayoutEffect(() => {
    const target = confirming ? confirmRef.current : removeRef.current;
    if (target) setWidth(target.scrollWidth);
  }, [confirming]);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        transition: `width ${DURATION_MS}ms ease-out`,
      }}
    >
      <div
        ref={removeRef}
        aria-hidden={confirming}
        className={cn(
          "flex w-fit",
          confirming && "pointer-events-none absolute inset-y-0 right-0",
        )}
        style={{
          opacity: confirming ? 0 : 1,
          transition: `opacity ${DURATION_MS}ms ease-out`,
        }}
      >
        <Button
          type="button"
          variant="destructive-subtle"
          size={size}
          disabled={disabled}
          tabIndex={confirming ? -1 : 0}
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      </div>
      <div
        ref={confirmRef}
        aria-hidden={!confirming}
        className={cn(
          "flex w-fit gap-2",
          !confirming && "pointer-events-none absolute inset-y-0 right-0",
        )}
        style={{
          opacity: confirming ? 1 : 0,
          transition: `opacity ${DURATION_MS}ms ease-out`,
        }}
      >
        <Button
          type="button"
          variant="destructive"
          size={size}
          disabled={disabled || busy}
          tabIndex={confirming ? 0 : -1}
          onClick={() => void handleConfirm()}
        >
          {busy ? "Removing…" : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={busy}
          tabIndex={confirming ? 0 : -1}
          onClick={() => setConfirming(false)}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
