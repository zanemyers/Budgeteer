import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * Publish the on-screen keyboard's height as `--keyboard-inset` on `<html>`.
 *
 * The sheet is anchored to the bottom of the *layout* viewport, and iOS Safari does not shrink that
 * when the keyboard opens — it only shrinks the visual viewport — so without this the sheet would
 * sit behind the keyboard. Chrome's `interactive-widget` viewport directive would solve it
 * declaratively, but Safari doesn't implement it, and Safari is the reason this is needed.
 *
 * `innerHeight` is the layout viewport, `visualViewport.height` the part still visible, and
 * `offsetTop` how far the visual viewport has been panned down inside it; what's left is the
 * keyboard. Only mounted while a dialog is open, so nothing listens the rest of the time.
 */
function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      // Rounded so a sub-pixel jitter during the keyboard animation doesn't restyle every frame.
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}

/**
 * Drag the grab handle down to dismiss.
 *
 * Bound to the handle alone rather than the whole sheet: a drag anywhere would fight the sheet's own
 * scrolling, and a handle that looks draggable and isn't is worse than no handle. Returns the live
 * offset so the sheet can follow the finger, and springs back if the drag was too short to count.
 */
function useSheetDrag(onDismiss: () => void) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (start.current === null) return;
    // Downward only. Dragging up would lift the sheet off the bottom edge it is anchored to.
    setOffset(Math.max(0, e.clientY - start.current));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (start.current === null) return;
      const travelled = e.clientY - start.current;
      start.current = null;
      setOffset(0);
      if (travelled > 80) onDismiss();
    },
    [onDismiss],
  );

  return { offset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // Lighter than a flat scrim, with a blur to push the page back without hiding it — the sheet
        // covers only part of the screen now, so what sits behind it is on show.
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  useKeyboardInset();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { offset, handlers } = useSheetDrag(() => closeRef.current?.click());

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        style={offset ? { transform: `translateY(${offset}px)`, transition: "none" } : undefined}
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-y-auto bg-background outline-none",
          // Below sm: a sheet on the bottom edge. It used to be the whole screen, which meant a
          // two-line confirm took the entire display with its buttons stranded in the middle of it.
          // Height follows the content up to a cap, so a short dialog is short.
          //
          // `bottom` and the cap both subtract --keyboard-inset (see useKeyboardInset): the keyboard
          // rises from the same edge the sheet is anchored to, so the sheet rides on top of it
          // rather than being covered by it, and shrinks instead of overflowing.
          "inset-x-0 bottom-[var(--keyboard-inset,0px)] max-h-[calc(88dvh-var(--keyboard-inset,0px))]",
          "rounded-t-2xl border-t px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.35)]",
          // From sm up: the centred card, where there is no keyboard to dodge.
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-lg",
          "sm:max-h-[calc(100dvh-4rem)] sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:rounded-2xl sm:border sm:p-6 sm:shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35)]",
          // The sheet slides from the edge it belongs to; the card scales in place. Scaling something
          // anchored to an edge reads as a glitch, so the slide is scoped below sm and vice versa.
          "duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {/* Reads as a sheet, and drags to dismiss so it isn't only decoration. Hidden from assistive
            tech: closing is already covered by the ✕ and by Escape. */}
        <div
          aria-hidden
          className="sticky -top-3 -mt-1 -mb-2 shrink-0 cursor-grab touch-none py-2 active:cursor-grabbing sm:hidden"
          {...handlers}
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-border-strong" />
        </div>
        {children}
        {/* The drag handle dismisses through this rather than through the visible ✕, which a caller
            can switch off — the handle would then have looked draggable and done nothing. Out of the
            tab order and hidden from assistive tech: it is a programmatic handle, not a control. */}
        <DialogPrimitive.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none max-sm:top-5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  // Left-aligned at every width. Centred text above left-aligned fields never lined up with
  // anything, and the ✕ sits in the top-right corner regardless.
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-8 text-left", className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        // Sits at the end of the content rather than sticking to the bottom of the scrollport. It
        // used to be `sticky bottom-0`, which meant that when the keyboard opened and the sheet
        // shrank, the buttons rode up with it and hovered above the keys — the sheet was resizing
        // under them and they read as chasing the keyboard rather than belonging to the form.
        // The sheet's height follows its content now, so for most dialogs they are on screen
        // without scrolling anyway; a long form scrolls to them like any other form.
        "mt-2 border-t pt-3 sm:mt-0 sm:border-0 sm:pt-0",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-tight font-semibold sm:text-lg", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
