import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BottomSheet from "../../src/components/mobile/BottomSheet";

describe("BottomSheet", () => {
  it("keeps its touches away from the handlers around its opener", () => {
    const onRowTouchEnd = vi.fn();
    render(
      <div onTouchEnd={onRowTouchEnd}>
        <BottomSheet isOpen onClose={vi.fn()}>
          <p>sheet body</p>
        </BottomSheet>
      </div>,
    );
    fireEvent.touchEnd(screen.getByText("sheet body"));
    expect(onRowTouchEnd).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is tapped", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet isOpen onClose={onClose}>
        <p>sheet body</p>
      </BottomSheet>,
    );
    fireEvent.click(document.querySelector(".scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
