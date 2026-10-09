import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSuggestionKeys } from "../../src/hooks/useSuggestionKeys";

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function setup(selectedIndex: number, onAccept = vi.fn(() => true)) {
  const onMove = vi.fn();
  const onClose = vi.fn();
  renderHook(() =>
    useSuggestionKeys({
      isActive: true,
      count: 3,
      selectedIndex,
      onMove,
      onAccept,
      onClose,
    }),
  );
  return { onMove, onAccept, onClose };
}

describe("useSuggestionKeys", () => {
  it("wraps the highlight around both ends", () => {
    const { onMove } = setup(2);
    press("ArrowDown");
    expect(onMove).toHaveBeenLastCalledWith(0);
  });

  it("wraps upwards from the first row", () => {
    const { onMove } = setup(0);
    press("ArrowUp");
    expect(onMove).toHaveBeenLastCalledWith(2);
  });

  it("accepts the highlighted row and consumes the key", () => {
    const { onAccept } = setup(1);
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(onAccept).toHaveBeenCalledWith(1);
  });

  it("leaves the key alone when accept declines it", () => {
    setup(
      1,
      vi.fn(() => false),
    );
    expect(press("Enter").defaultPrevented).toBe(false);
  });

  it("steps forward on a cycle key and backward with Shift", () => {
    const onMove = vi.fn();
    renderHook(() =>
      useSuggestionKeys({
        isActive: true,
        count: 3,
        selectedIndex: 0,
        onMove,
        onAccept: vi.fn(() => true),
        onClose: vi.fn(),
        cycleKeys: ["Tab"],
      }),
    );
    press("Tab");
    expect(onMove).toHaveBeenLastCalledWith(1);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
    );
    expect(onMove).toHaveBeenLastCalledWith(2);
  });

  it("closes on Escape", () => {
    const { onClose } = setup(0);
    press("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
