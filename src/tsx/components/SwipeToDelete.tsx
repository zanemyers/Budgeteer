import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How far the row slides to park open, and how far you must drag to get it there. */
const REVEAL_PX = 88;
const COMMIT_PX = REVEAL_PX / 2;
/** Movement before we decide whether this is a swipe or a scroll. */
const INTENT_PX = 8;

interface Props {
  /** Opens the confirm. Deleting is never the swipe itself — see the note on the button. */
  onDelete: () => void;
  /** Controlled so the parent can keep one row open at a time. */
  revealed: boolean;
  onRevealedChange: (revealed: boolean) => void;
  children: React.ReactNode;
}

/**
 * Swipe a row left to uncover a Delete button.
 *
 * Touch only. A mouse drag across a row is not a gesture anyone means, and the desktop layout has
 * room for real controls; on a phone deleting one transaction otherwise costs five taps — overflow
 * menu, selection mode, tick the row, Delete, confirm.
 *
 * The gesture only ever *reveals* the button. Deleting still takes a deliberate tap and then a
 * confirm, so a stray swipe while scrolling cannot destroy anything.
 */
export function SwipeToDelete({ onDelete, revealed, onRevealedChange, children }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Mirrored in a ref because pointerup has to read the offset the last pointermove set, and that
  // move may not have re-rendered yet — releasing right after a fast flick would otherwise decide
  // against a stale value and snap the row shut.
  const dxRef = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // null while the direction is still undecided, then true for a swipe and false for a scroll.
  const horizontal = useRef<boolean | null>(null);
  const swiped = useRef(false);

  // Has the row moved at all? Drives both the action layer and the sliding layer's background.
  const slid = dx !== 0;

  function offset(next: number) {
    dxRef.current = next;
    setDx(next);
  }

  // Only for the parent closing this row because another one opened; a drag snaps itself.
  useEffect(() => {
    if (!dragging) {
      dxRef.current = revealed ? -REVEAL_PX : 0;
      setDx(dxRef.current);
    }
  }, [revealed, dragging]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    start.current = { x: e.clientX, y: e.clientY };
    horizontal.current = null;
    swiped.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const moveX = e.clientX - start.current.x;
    const moveY = e.clientY - start.current.y;

    // Decide once, on the first meaningful movement. Guessing per-event would let a diagonal scroll
    // flicker between the two and steal the page's vertical panning.
    if (horizontal.current === null) {
      if (Math.abs(moveX) < INTENT_PX && Math.abs(moveY) < INTENT_PX) return;
      horizontal.current = Math.abs(moveX) > Math.abs(moveY);
      if (horizontal.current) setDragging(true);
    }
    if (!horizontal.current) return;

    swiped.current = true;
    // Leftward only, and no further than the button it uncovers.
    offset(Math.max(-REVEAL_PX, Math.min(0, (revealed ? -REVEAL_PX : 0) + moveX)));
  }

  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (!horizontal.current) return;
    // Snap here rather than leaving it to the effect below. A quick flick can batch the drag's
    // start and end into one commit, so `dragging` never changes value, so an effect keyed on it
    // never re-runs — and the row stops wherever the finger left it.
    const open = dxRef.current < -COMMIT_PX;
    offset(open ? -REVEAL_PX : 0);
    onRevealedChange(open);
  }

  return (
    <div className="relative overflow-hidden">
      {/* Only while the row has actually moved. It sits *behind* the sliding layer, and that layer
          is only opaque once it moves — it has to stay transparent at rest or it would mask the
          row's own hover and selected tints — so a button rendered at rest showed straight through
          the row, permanently, on top of the amount. The two conditions have to agree. */}
      {slid && (
        <div className="absolute inset-y-0 right-0 flex w-[88px] items-stretch justify-end py-1.5 pr-2">
          <button
            type="button"
            // tabIndex -1 and aria-hidden: this is a touch shortcut for something the row's own menu
            // already offers, and a keyboard user would otherwise tab through a hidden control on
            // every row of a long register.
            tabIndex={-1}
            aria-hidden
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg bg-destructive text-[0.6875rem] font-medium text-destructive-foreground active:brightness-95"
            onClick={(e) => {
              // The row underneath opens the editor on click, and this button is a sibling of the
              // sliding layer rather than inside it — so without this the tap opened the transaction
              // and then the confirm on top of it.
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Delete
          </button>
        </div>
      )}

      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 200ms cubic-bezier(0.22,1,0.36,1)",
        }}
        // pan-y, not none: the page must still scroll vertically through the row. The browser hands
        // us horizontal movement and keeps the vertical for itself.
        className={`relative touch-pan-y ${slid ? "bg-card" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Capture phase: the row underneath opens a modal on click, and the click that ends a swipe
        // would otherwise open it on top of the button just uncovered.
        onClickCapture={(e) => {
          if (swiped.current || revealed) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
            if (revealed) onRevealedChange(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
