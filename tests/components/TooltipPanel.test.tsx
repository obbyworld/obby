import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPanel } from "../../src/components/ui/HoverTooltip";

const TIP_WIDTH = 120;

function renderTip(anchorLeft: number, anchorWidth: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: TIP_WIDTH,
    height: 20,
  } as DOMRect);
  render(
    <TooltipPanel
      id="tip"
      anchor={{
        x: anchorLeft + anchorWidth / 2,
        y: 200,
        bottom: 220,
        left: anchorLeft,
        width: anchorWidth,
      }}
    >
      hint
    </TooltipPanel>,
  );
  return screen.getByRole("tooltip");
}

describe("TooltipPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts at the left edge of an element wider than the hint", () => {
    expect(renderTip(300, 700).style.left).toBe("300px");
  });

  it("centres on an element narrower than the hint", () => {
    expect(renderTip(300, 24).style.left).toBe(`${312 - TIP_WIDTH / 2}px`);
  });

  it("lets a hint on a wide element grow to that element's width", () => {
    expect(renderTip(300, 700).style.maxWidth).toBe("700px");
  });
});
