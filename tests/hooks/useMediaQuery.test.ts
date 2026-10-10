import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../../src/hooks/useMediaQuery";

describe("useMediaQuery", () => {
  let list: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    list = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => list as unknown as MediaQueryList);
  });

  it("starts with the current match", () => {
    list.matches = true;
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("follows a change of the query's match", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    const onChange = list.addEventListener.mock.calls[0][1];
    act(() => {
      list.matches = true;
      onChange();
    });
    expect(result.current).toBe(true);
  });

  it("shares one query list between components and unsubscribes on unmount", () => {
    const first = renderHook(() => useMediaQuery("(pointer: coarse)"));
    const second = renderHook(() => useMediaQuery("(pointer: coarse)"));
    expect(window.matchMedia).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
    expect(list.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("reads a new query", () => {
    const { rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: "(max-width: 768px)" },
    });
    rerender({ query: "(max-width: 1080px)" });
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 1080px)");
  });
});
