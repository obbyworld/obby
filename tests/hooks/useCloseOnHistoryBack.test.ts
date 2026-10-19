import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCloseOnHistoryBack } from "../../src/hooks/useCloseOnHistoryBack";

describe("useCloseOnHistoryBack", () => {
  it("closes on back and takes its entry off history when closed another way", () => {
    const onClose = vi.fn();
    const back = vi.spyOn(window.history, "back");
    const { rerender } = renderHook(
      ({ open }) => useCloseOnHistoryBack(open, onClose),
      { initialProps: { open: true } },
    );
    expect(window.history.state).toEqual({ obbyOverlay: true });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(onClose).toHaveBeenCalledOnce();
    rerender({ open: false });
    expect(back).not.toHaveBeenCalled();

    rerender({ open: true });
    rerender({ open: false });
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
