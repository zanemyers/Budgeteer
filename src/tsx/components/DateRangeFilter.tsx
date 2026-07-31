import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** The assumed month as "YYYY-MM" — the range is days within it. */
  month: string;
  from: string; // full ISO date ("YYYY-MM-DD") or ""
  to: string;
  onChange: (from: string, to: string) => void;
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

export function DateRangeFilter({ month, from, to, onChange }: Props) {
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

  function commit() {
    if (anchor === null) return;
    const h = hover ?? anchor;
    onChange(iso(Math.min(anchor, h)), iso(Math.max(anchor, h)));
    setAnchor(null);
    setHover(null);
    setOpen(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bound on open/anchor/hover; commit reads current values
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
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
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, anchor, hover]);

  const cells: { id: string; day: number | null }[] = [
    ...Array.from({ length: firstWeekday }, (_, i) => ({ id: `pad-${i}`, day: null })),
    ...Array.from({ length: lastDay }, (_, i) => ({ id: `day-${i + 1}`, day: i + 1 })),
  ];

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={active ? "border-moss text-foreground" : ""}
        onClick={() => setOpen((o) => !o)}
      >
        {appliedLabel}
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-md border border-rule bg-popover p-3 shadow-md select-none">
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
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAnchor(d);
                    setHover(d);
                  }}
                  onMouseEnter={() => dragging && setHover(d)}
                  className={`h-8 rounded-sm text-sm tabular-nums transition-colors ${
                    isEnd(d) ? "bg-moss text-white" : inRange(d) ? "bg-moss-soft text-ink" : "hover:bg-muted"
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
          <div className="flex justify-between items-center pt-2 mt-1 border-t">
            <span className="text-[0.7rem] text-muted-foreground">Click or drag to pick days</span>
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
