import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { firePointer } from "../test/setup";
import { SwipeToDelete } from "./SwipeToDelete";

const REVEAL = 88;

/**
 * Wraps the controlled component the way a row does: `revealed` lifted to the parent so one row is
 * open at a time, and a click handler on the container standing in for the row that opens the
 * transaction editor.
 */
function Harness({ onDelete = () => {} }: { onDelete?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the <tr> onClick the real row carries
    // biome-ignore lint/a11y/useKeyWithClickEvents: ditto — the real row's keyboard route is a button inside it
    <div data-testid="row" data-opened={opened || undefined} onClick={() => setOpened(true)}>
      <SwipeToDelete onDelete={onDelete} revealed={revealed} onRevealedChange={setRevealed}>
        <span data-testid="content">Watson's Pest Control</span>
      </SwipeToDelete>
    </div>
  );
}

const slider = () => document.querySelector(".touch-pan-y") as HTMLElement;
const offset = () => slider().style.transform;
const deleteButton = () => document.querySelector("button[aria-hidden]");

describe("SwipeToDelete", () => {
  it("stays put and shows no button until it is swiped", () => {
    render(<Harness />);
    expect(offset()).toBe("translateX(0px)");
    // The button lives *behind* the sliding layer, which is only opaque once it moves — so
    // rendering it at rest showed it straight through the row, on top of the amount.
    expect(deleteButton()).toBeNull();
  });

  it("follows the finger and parks open past the halfway point", () => {
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 260, y: 40 });
    });
    expect(offset()).toBe("translateX(-40px)");

    // Past REVEAL/2 — 40px alone springs back, which the previous case covers.
    act(() => firePointer(slider(), "pointermove", { x: 240, y: 40 }));
    act(() => firePointer(slider(), "pointerup", { x: 240, y: 40 }));
    expect(offset()).toBe(`translateX(-${REVEAL}px)`);
    expect(deleteButton()).toBeInTheDocument();
  });

  it("springs back when the swipe is too short", () => {
    // Regression: the snap used to be left to an effect keyed on `dragging`. A quick gesture
    // batches its start and end into one commit, so that value never changes, so the effect never
    // re-runs — and the row stopped wherever the finger left it.
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 285, y: 40 });
      firePointer(slider(), "pointerup", { x: 285, y: 40 });
    });
    expect(offset()).toBe("translateX(0px)");
    expect(deleteButton()).toBeNull();
  });

  it("parks open on a flick with no render between the last move and the release", () => {
    // Regression: pointerup read the offset from state, which is stale if the last pointermove has
    // not re-rendered. A fast flick therefore decided against an old value and snapped shut.
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 260, y: 40 });
      firePointer(slider(), "pointermove", { x: 190, y: 40 });
      firePointer(slider(), "pointerup", { x: 190, y: 40 });
    });
    expect(offset()).toBe(`translateX(-${REVEAL}px)`);
  });

  it("ignores a vertical drag, so the page still scrolls through the row", () => {
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 302, y: 90 });
    });
    expect(offset()).toBe("translateX(0px)");
  });

  it("ignores a mouse drag entirely", () => {
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40, pointerType: "mouse" });
      firePointer(slider(), "pointermove", { x: 180, y: 40, pointerType: "mouse" });
      firePointer(slider(), "pointerup", { x: 180, y: 40, pointerType: "mouse" });
    });
    expect(offset()).toBe("translateX(0px)");
  });

  it("cannot be dragged past the button, or up off its edge", () => {
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 100, y: 40 });
    });
    expect(offset()).toBe(`translateX(-${REVEAL}px)`);

    act(() => firePointer(slider(), "pointermove", { x: 400, y: 40 }));
    expect(offset()).toBe("translateX(0px)");
  });

  it("asks to delete without also triggering the row underneath", () => {
    // The button is a sibling of the sliding layer, so its click bubbles to the row — which opens
    // the transaction editor. Without stopPropagation you got the editor *and* the confirm.
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 190, y: 40 });
      firePointer(slider(), "pointerup", { x: 190, y: 40 });
    });

    act(() => {
      (deleteButton() as HTMLElement).click();
    });
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.getByTestId("row")).not.toHaveAttribute("data-opened");
  });

  it("swallows the click that ends a swipe", () => {
    render(<Harness />);
    act(() => {
      firePointer(slider(), "pointerdown", { x: 300, y: 40 });
      firePointer(slider(), "pointermove", { x: 190, y: 40 });
      firePointer(slider(), "pointerup", { x: 190, y: 40 });
    });
    // Separate act: the browser delivers this click in a later task, by which point the row has
    // re-rendered as revealed. Firing it in the same commit tests a state that cannot happen.
    act(() => {
      slider().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // The row must not open, and the swipe closes instead.
    expect(screen.getByTestId("row")).not.toHaveAttribute("data-opened");
    expect(offset()).toBe("translateX(0px)");
  });
});
