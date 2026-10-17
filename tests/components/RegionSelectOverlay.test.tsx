import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/screenRegion", () => ({
  publishRegionSelection: vi.fn(() => Promise.resolve()),
  cancelRegionSelection: vi.fn(() => Promise.resolve()),
  MIN_REGION_FRACTION: 0.01,
}));

import { RegionSelectOverlay } from "../../src/components/ui/RegionSelectOverlay";
import {
  cancelRegionSelection,
  publishRegionSelection,
} from "../../src/lib/screenRegion";

const publish = vi.mocked(publishRegionSelection);
const cancel = vi.mocked(cancelRegionSelection);

beforeEach(() => {
  // The overlay window is exactly one monitor, so the rectangle is reported as
  // fractions of the window and no screen scaling maths is involved.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 500,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  const overlay = screen.getByTestId("region-overlay");
  fireEvent.mouseDown(overlay, { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(overlay, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(overlay, { clientX: to.x, clientY: to.y });
}

describe("RegionSelectOverlay", () => {
  it("reports the dragged rectangle as fractions of the screen", () => {
    render(<RegionSelectOverlay monitor={1} />);

    drag({ x: 250, y: 100 }, { x: 750, y: 350 });

    expect(publish).toHaveBeenCalledWith({
      monitor: 1,
      region: { x: 0.25, y: 0.2, width: 0.5, height: 0.5 },
    });
  });

  // Dragging up and to the left is the same rectangle as dragging down and to
  // the right, which is how every selection tool behaves.
  it("accepts a drag in any direction", () => {
    render(<RegionSelectOverlay monitor={0} />);

    drag({ x: 750, y: 350 }, { x: 250, y: 100 });

    expect(publish).toHaveBeenCalledWith({
      monitor: 0,
      region: { x: 0.25, y: 0.2, width: 0.5, height: 0.5 },
    });
  });

  it("treats a stray click as a cancel rather than a tiny recording", () => {
    render(<RegionSelectOverlay monitor={0} />);

    drag({ x: 400, y: 200 }, { x: 402, y: 201 });

    expect(publish).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("offers a way out that needs no keyboard focus", () => {
    render(<RegionSelectOverlay monitor={0} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: /cancel/i }));

    expect(cancel).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels on escape", () => {
    render(<RegionSelectOverlay monitor={0} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(cancel).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("shows the selection while it is being dragged", () => {
    render(<RegionSelectOverlay monitor={0} />);
    const overlay = screen.getByTestId("region-overlay");

    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(overlay, { clientX: 300, clientY: 250 });

    const box = screen.getByTestId("region-box");
    expect(box.style.left).toBe("100px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("150px");
  });
});
