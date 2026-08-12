import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

/**
 * Dispatch a pointer event jsdom can carry.
 *
 * jsdom has no PointerEvent, and the components under test read `pointerType` to tell a finger from
 * a mouse — the whole basis of "touch only" — so a plain MouseEvent would exercise the wrong branch
 * and quietly pass. This builds a MouseEvent and attaches the pointer fields the handlers read.
 */
export function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  { x = 0, y = 0, pointerType = "touch" }: { x?: number; y?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { get: () => pointerType });
  Object.defineProperty(event, "pointerId", { get: () => 1 });
  el.dispatchEvent(event);
}
