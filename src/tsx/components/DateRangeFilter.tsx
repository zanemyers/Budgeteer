import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** The assumed month as "YYYY-MM" — the range is days within it. */
  month: string;
  from: string; // full ISO date ("YYYY-MM-DD") or ""
  to: string;
  onChange: (from: string, to: string) => void;
  /** Applied to the wrapper, so a caller can make the trigger fill a labelled filter row. */
  className?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    year: y,
    month: m,
    lastDay: new Date(y, m, 0).getDate(),
    firstWeekday: new Date(y, m - 1, 1).getDay(),
    short: new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" }),
  };
}

const dayOf = (iso: string) => (iso ? Number(iso.slice(8, 10)) : null);

export function DateRangeFilter({ month, from, to, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { lastDay, firstWeekday, short } = parts(month);

  // Drag state: anchor is where the press started, hover follows the pointer.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const appliedFrom = dayOf(from);
  const appliedTo = dayOf(to);
  const active = Boolean(from || to);

  const iso = (day: number) => `${month}-${String(day).padStart(2, "0")}`;

  const appliedLabel = (() => {
    if (appliedFrom && appliedTo) {
      return appliedFrom === appliedTo ? `${short} ${appliedFrom}` : `${short} ${appliedFrom}–${appliedTo}`;
    }
    if (appliedFrom) return `${short} ${appliedFrom}+`;
    if (appliedTo) return `Through ${short} ${appliedTo}`;
    return "Any day";
  })();

  // The range currently shown: the live drag preview, else the applied range.
  const dragging = anchor !== null;
  const lo = dragging ? Math.min(anchor, hover ?? anchor) : appliedFrom;
  const hi = dragging ? Math.max(anchor, hover ?? anchor) : appliedTo;
  const inRange = (d: number) => lo !== null && hi !== null && d >= lo && d <= hi;
  const isEnd = (d: number) => d === lo || d === hi;

  function commitRange(a: number, b: number) {
    onChange(iso(Math.min(a, b)), iso(Math.max(a, b)));
    setAnchor(null);
    setHover(null);
    setOpen(false);
  }

  function commit() {
    if (anchor === null) return;
    commitRange(anchor, hover ?? anchor);
  }

  /**
   * Keyboard activation of a day.
   *
   * The cells only had onMouseDown, and Enter/Space on a button dispatches `click`, never
   * `mousedown` — so every day was reachable by Tab and none could be selected (WCAG 2.1.1).
   * Pointer clicks are already handled by the mousedown/mouseup pair, and a keyboard-generated
   * click is distinguishable by `detail === 0`.
   */
  function onDayClick(e: React.MouseEvent, day: number) {
    if (e.detail !== 0) return;
    if (anchor === null) {
      setAnchor(day);
      setHover(day);
    } else {
      commitRange(anchor, day);
    }
  }

  /** Arrow-key movement, so reaching a date doesn't mean Tabbing through the whole month. */
  function onDayKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, day: number) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    const next = Math.min(lastDay, Math.max(1, day + step));
    const target = ref.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`);
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (anchor !== null) setHover(next);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bound on open/anchor/hover; commit reads current values
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onUp() {
      if (anchor !== null) commit();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAnchor(null);
        setHover(null);
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, anchor, hover]);

  // Move focus into the grid on open and back to the trigger on close, so keyboard users
  // aren't left tabbing from the top of the page to reach a popover that just appeared.
  useEffect(() => {
    if (!open) return;
    const target = ref.current?.querySelector<HTMLButtonElement>(`[data-day="${appliedFrom ?? 1}"]`);
    target?.focus();
  }, [open, appliedFrom]);

  const cells: { id: string; day: number | null }[] = [
    ...Array.from({ length: firstWeekday }, (_, i) => ({ id: `pad-${i}`, day: null })),
    ...Array.from({ length: lastDay }, (_, i) => ({ id: `day-${i + 1}`, day: i + 1 })),
  ];

  return (
    <div className={`relative ${className ?? ""}`} ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        // Fills its labelled row on a phone; natural width once the row dissolves at md.
        className={`w-full justify-between md:w-auto md:justify-center ${active ? "border-moss text-foreground" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {appliedLabel}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={`Pick days in ${short}`}
          // w-64 gives 29px cells across seven columns — half a finger. On a coarse pointer the
          // popover widens so the cells can reach 44px tall and ~39 wide, and anchors to the right
          // edge, because at 390px the extra width would otherwise run off the screen: the trigger
          // sits about 108px in, and 108 + 320 is past the viewport.
          className="absolute z-50 mt-1 w-64 rounded-md border border-rule bg-popover p-3 shadow-md select-none touch:right-0 touch:w-[20rem]"
        >
          <p className="text-sm font-medium mb-2 text-center">{short}</p>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[0.65rem] text-muted-foreground">
                {w[0]}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ id, day: d }) =>
              d === null ? (
                <div key={id} />
              ) : (
                <button
                  key={id}
                  type="button"
                  data-day={d}
                  // Names the month too: on its own the accessible name was just "5".
                  aria-label={`${short} ${d}`}
                  // Selection was conveyed by background colour alone.
                  aria-pressed={inRange(d)}
                  // Pointer events, not mouse. A finger drag fires no mouseenter — the browser
                  // only synthesises mouse events once the touch has *ended* — so dragging a range
                  // did nothing on a phone and the picker could only ever select a single day.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setAnchor(d);
                    setHover(d);
                  }}
                  // Touch gives the first element implicit pointer capture, so pointermove keeps
                  // firing on the day the drag *started* on and never on the one under the finger.
                  // Hit-testing the point is what makes the range follow.
                  onPointerMove={(e) => {
                    if (anchor === null) return;
                    const over = document.elementFromPoint(e.clientX, e.clientY);
                    const day = over?.closest("[data-day]")?.getAttribute("data-day");
                    if (day) setHover(Number(day));
                  }}
                  onClick={(e) => onDayClick(e, d)}
                  onKeyDown={(e) => onDayKeyDown(e, d)}
                  className={`h-8 touch:h-11 touch-none rounded-sm text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 ${
                    isEnd(d) ? "bg-moss text-moss-foreground" : inRange(d) ? "bg-moss-soft text-ink" : "hover:bg-muted"
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
          <div className="flex justify-between items-center pt-2 mt-1 border-t">
            <span className="text-[0.7rem] text-muted-foreground">Click, drag, or use arrow keys</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!active}
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
