import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/**
 * Stand in for the visual viewport, which jsdom does not implement.
 *
 * The real numbers are the point: on iOS the *layout* viewport (window.innerHeight) does not shrink
 * when the keyboard opens — only visualViewport.height does — which is the whole reason the sheet
 * cannot simply sit at bottom: 0.
 */
function mockViewport({ height, offsetTop = 0 }: { height: number; offsetTop?: number }) {
  const listeners: Record<string, (() => void)[]> = { resize: [], scroll: [] };
  const vv = {
    height,
    offsetTop,
    addEventListener: (t: string, fn: () => void) => listeners[t]?.push(fn),
    removeEventListener: (t: string, fn: () => void) => {
      listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn);
    },
    resizeTo(next: number, top = 0) {
      vv.height = next;
      vv.offsetTop = top;
      for (const fn of listeners.resize) fn();
    },
    listenerCount: () => listeners.resize.length + listeners.scroll.length,
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  return vv;
}

const inset = () => document.documentElement.style.getPropertyValue("--keyboard-inset");

afterEach(() => {
  document.documentElement.style.removeProperty("--keyboard-inset");
});

describe("dialog keyboard inset", () => {
  it("is zero with no keyboard up", () => {
    window.innerHeight = 844;
    mockViewport({ height: 844 });
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(inset()).toBe("0px");
  });

  it("reports the keyboard's height when the visual viewport shrinks", () => {
    window.innerHeight = 844;
    const vv = mockViewport({ height: 844 });
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // A 336px keyboard: the layout viewport is unchanged, which is exactly the iOS behaviour the
    // sheet has to compensate for.
    act(() => vv.resizeTo(508));
    expect(inset()).toBe("336px");
  });

  it("accounts for the visual viewport being panned down inside the layout one", () => {
    window.innerHeight = 844;
    const vv = mockViewport({ height: 844 });
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // Safari pans the visual viewport to bring a focused field into view; without subtracting
    // offsetTop the sheet would be pushed up by the pan as well as by the keyboard.
    act(() => vv.resizeTo(508, 40));
    expect(inset()).toBe("296px");
  });

  it("never reports a negative inset", () => {
    window.innerHeight = 844;
    const vv = mockViewport({ height: 844 });
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // Desktop browsers can report a visual viewport taller than the layout one while rubber-banding.
    act(() => vv.resizeTo(900));
    expect(inset()).toBe("0px");
  });

  it("stops listening and clears the variable when the dialog closes", () => {
    window.innerHeight = 844;
    const vv = mockViewport({ height: 844 });
    const { rerender } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(vv.listenerCount()).toBeGreaterThan(0);

    rerender(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // Nothing should listen while no dialog is open, and a stale inset would leave the next sheet
    // floating above a keyboard that is no longer there.
    expect(vv.listenerCount()).toBe(0);
    expect(inset()).toBe("");
  });
});
