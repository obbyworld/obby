import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HoverTooltip from "../../../src/components/ui/HoverTooltip";

const useCoarsePointer = (isCoarse: boolean) =>
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: isCoarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));

describe("HoverTooltip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows on mouse hover", () => {
    useCoarsePointer(false);
    render(<HoverTooltip content="Why">trigger</HoverTooltip>);
    fireEvent.mouseEnter(screen.getByText("trigger"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Why");
  });

  it("describes the trigger for screen readers without a hover", () => {
    useCoarsePointer(false);
    render(<HoverTooltip content="Why">trigger</HoverTooltip>);
    expect(screen.getByText("trigger")).toHaveAccessibleDescription("Why");
  });

  it("ignores a tap replayed as mouseenter and focus, and toggles on the tap itself", () => {
    useCoarsePointer(true);
    render(
      <>
        <HoverTooltip content="Why">trigger</HoverTooltip>
        <span>elsewhere</span>
      </>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Why");

    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
