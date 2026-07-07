import { act, renderHook } from "@testing-library/react";
import type React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { useSwipeNavigation } from "../../src/hooks/useSwipeNavigation";

describe("useSwipeNavigation", () => {
  let onPageChange: Mock<(page: number) => void>;

  beforeEach(() => {
    onPageChange = vi.fn<(page: number) => void>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const createTouchEvent = (
    type: "touchstart" | "touchmove" | "touchend",
    clientX: number,
    clientY: number,
  ): React.TouchEvent => {
    const event = {
      touches: type !== "touchend" ? [{ clientX, clientY }] : [],
      preventDefault: vi.fn(),
      target: {
        closest: vi.fn(() => null),
      },
    } as unknown as React.TouchEvent;
    return event;
  };

  it("should initialize with correct default values", () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({
        currentPage: 0,
        totalPages: 3,
        onPageChange,
      }),
    );

    expect(result.current.offset).toBe(0);
    expect(result.current.isTransitioning).toBe(false);
    expect(result.current.containerRef.current).toBeNull();
  });

  it("should use custom threshold and rubberBandStrength", () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({
        currentPage: 0,
        totalPages: 3,
        onPageChange,
        threshold: 100,
        rubberBandStrength: 0.5,
      }),
    );

    expect(result.current).toBeDefined();
  });

  describe("Direction locking", () => {
    it("should detect horizontal swipe when horizontal movement is greater", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 130, 105));
      });

      expect(result.current.offset).not.toBe(0);
    });

    it("should not handle swipe when vertical movement is greater", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 105, 130));
      });

      expect(result.current.offset).toBe(0);
    });

    it("should lock direction after first significant movement", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 130, 100));
      });

      const firstOffset = result.current.offset;
      expect(firstOffset).not.toBe(0);

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 140, 200));
      });

      expect(result.current.offset).not.toBe(firstOffset);
      expect(result.current.offset).toBeGreaterThan(0);
    });
  });

  describe("Page changes", () => {
    it("should change page forward when swiping left beyond threshold", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
          threshold: 50,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 30, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it("should change page backward when swiping right beyond threshold", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
          threshold: 50,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 170, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).toHaveBeenCalledWith(0);
    });

    it("should not change page when swipe is below threshold", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
          threshold: 50,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 130, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("should not change to page before first page", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 0,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 200, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("should not change to page after last page", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 2,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 0, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  describe("Rubber-band effect", () => {
    it("should apply rubber-band resistance at first page when swiping right", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 0,
          totalPages: 3,
          onPageChange,
          rubberBandStrength: 0.3,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 200, 100));
      });

      expect(result.current.offset).toBe(100 * 0.3);
    });

    it("should apply rubber-band resistance at last page when swiping left", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 2,
          totalPages: 3,
          onPageChange,
          rubberBandStrength: 0.3,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 0, 100));
      });

      expect(result.current.offset).toBe(-100 * 0.3);
    });

    it("should not apply rubber-band on middle pages", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
          rubberBandStrength: 0.3,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 200, 100));
      });

      expect(result.current.offset).toBe(100);
    });
  });

  describe("Transition state", () => {
    it("should set isTransitioning to true after touch end", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 30, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(result.current.isTransitioning).toBe(true);
    });

    it("should reset isTransitioning after timeout", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 30, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(result.current.isTransitioning).toBe(true);

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.isTransitioning).toBe(false);
    });

    it("should ignore touch move when isTransitioning is true", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 30, 100));
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      const offsetAfterEnd = result.current.offset;

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 200, 100));
      });

      expect(result.current.offset).toBe(offsetAfterEnd);
    });
  });

  describe("Touch state reset", () => {
    it("should reset offset to 0 after touch end", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchMove(createTouchEvent("touchmove", 130, 100));
      });

      expect(result.current.offset).not.toBe(0);

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(result.current.offset).toBe(0);
    });

    it("should not trigger touch end actions if not dragging", () => {
      const { result } = renderHook(() =>
        useSwipeNavigation({
          currentPage: 1,
          totalPages: 3,
          onPageChange,
        }),
      );

      act(() => {
        result.current.handleTouchStart(
          createTouchEvent("touchstart", 100, 100),
        );
      });

      act(() => {
        result.current.handleTouchEnd(createTouchEvent("touchend", 0, 0));
      });

      expect(onPageChange).not.toHaveBeenCalled();
      expect(result.current.isTransitioning).toBe(false);
    });
  });
});
