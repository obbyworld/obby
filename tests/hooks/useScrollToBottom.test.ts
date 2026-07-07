import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isScrolledToBottom,
  useScrollToBottom,
} from "../../src/hooks/useScrollToBottom";

describe("isScrolledToBottom", () => {
  it("should return true when at the bottom", () => {
    const container = {
      scrollHeight: 1000,
      scrollTop: 970,
      clientHeight: 500,
    } as HTMLElement;

    expect(isScrolledToBottom(container, 30)).toBe(true);
  });

  it("should return false when scrolled up", () => {
    const container = {
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 500,
    } as HTMLElement;

    expect(isScrolledToBottom(container, 30)).toBe(false);
  });

  it("should respect custom tolerance", () => {
    const container = {
      scrollHeight: 1000,
      scrollTop: 460,
      clientHeight: 500,
    } as HTMLElement;

    expect(isScrolledToBottom(container, 50)).toBe(true);
    expect(isScrolledToBottom(container, 30)).toBe(false);
  });

  it("should handle edge case where scrollTop is exactly at bottom", () => {
    const container = {
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 500,
    } as HTMLElement;

    expect(isScrolledToBottom(container, 30)).toBe(true);
  });
});

function setDim(
  el: HTMLElement,
  key: "clientHeight" | "scrollHeight",
  value: number,
) {
  Object.defineProperty(el, key, { value, configurable: true, writable: true });
}

describe("useScrollToBottom", () => {
  let mockContainer: HTMLElement;
  let mockEndElement: HTMLElement;
  let observerCallbacks: IntersectionObserverCallback[] = [];
  let observedElements: Element[] = [];
  let resizeObserverCallbacks: ResizeObserverCallback[] = [];
  let resizeObservedElements: Element[] = [];
  let resizeDisconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    observerCallbacks = [];
    observedElements = [];
    resizeObserverCallbacks = [];
    resizeObservedElements = [];
    resizeDisconnectSpy = vi.fn();

    mockContainer = {
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 500,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;

    mockEndElement = {} as unknown as HTMLElement;

    // vitest 4 invokes constructor mocks with `new`, which an arrow
    // implementation can't satisfy; plain functions returning the instance can.
    function makeIntersectionObserver(callback: IntersectionObserverCallback) {
      observerCallbacks.push(callback);
      return {
        observe: vi.fn((element) => observedElements.push(element)),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
        takeRecords: vi.fn(),
        root: null,
        rootMargin: "",
        thresholds: [],
      };
    }
    global.IntersectionObserver = vi
      .fn()
      .mockImplementation(makeIntersectionObserver);

    function makeResizeObserver(callback: ResizeObserverCallback) {
      resizeObserverCallbacks.push(callback);
      return {
        observe: vi.fn((element) => resizeObservedElements.push(element)),
        disconnect: resizeDisconnectSpy,
        unobserve: vi.fn(),
      };
    }
    global.ResizeObserver = vi.fn().mockImplementation(makeResizeObserver);

    global.requestAnimationFrame = vi.fn((cb) => {
      setTimeout(cb, 0);
      return 0;
    });

    global.cancelAnimationFrame = vi.fn();
  });

  it("should initialize with isScrolledUp as false", () => {
    const { result } = renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(result.current.isScrolledUp).toBe(false);
  });

  it("should provide scrollToBottom function that sets scrollTop", () => {
    const { result } = renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(result.current.scrollToBottom).toBeInstanceOf(Function);

    result.current.scrollToBottom();
    expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
  });

  it("should set up IntersectionObserver", () => {
    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(global.IntersectionObserver).toHaveBeenCalled();
    expect(observedElements).toContain(mockEndElement);
  });

  it("should add scroll and touchend event listeners", () => {
    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(mockContainer.addEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      { passive: true },
    );
    expect(mockContainer.addEventListener).toHaveBeenCalledWith(
      "touchend",
      expect.any(Function),
      { passive: true },
    );
  });

  it("should update isScrolledUp when IntersectionObserver fires", () => {
    const { result } = renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    const callback = observerCallbacks[0];

    act(() => {
      callback(
        [
          {
            isIntersecting: false,
            target: mockEndElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    expect(result.current.isScrolledUp).toBe(true);
  });

  it("should clean up on unmount", () => {
    const intersectionDisconnectSpy = vi.fn();
    function makeUnmountObserver() {
      return {
        observe: vi.fn(),
        disconnect: intersectionDisconnectSpy,
        unobserve: vi.fn(),
        takeRecords: vi.fn(),
        root: null,
        rootMargin: "",
        thresholds: [],
      };
    }
    global.IntersectionObserver = vi
      .fn()
      .mockImplementation(makeUnmountObserver);

    const { unmount } = renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    unmount();

    expect(intersectionDisconnectSpy).toHaveBeenCalled();
    expect(resizeDisconnectSpy).toHaveBeenCalled();
    expect(mockContainer.removeEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
    );
    expect(mockContainer.removeEventListener).toHaveBeenCalledWith(
      "touchend",
      expect.any(Function),
    );
  });

  it("should reinitialize when channelId changes", () => {
    const { rerender } = renderHook(
      ({ channelId }) => {
        const containerRef = useRef(mockContainer);
        const endElementRef = useRef(mockEndElement);
        return useScrollToBottom(containerRef, endElementRef, { channelId });
      },
      { initialProps: { channelId: "channel1" } },
    );

    const initialObserverCount = observerCallbacks.length;

    rerender({ channelId: "channel2" });

    expect(observerCallbacks.length).toBeGreaterThan(initialObserverCount);
  });

  it("should handle null refs gracefully", () => {
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(null);
      const endElementRef = useRef<HTMLElement>(null);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(result.current.isScrolledUp).toBe(false);
    expect(() => result.current.scrollToBottom()).not.toThrow();
  });

  it("should use custom tolerance", () => {
    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef, { tolerance: 50 });
    });

    expect(global.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        rootMargin: "50px",
      }),
    );
  });

  it("should set up ResizeObserver on the container", () => {
    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    expect(global.ResizeObserver).toHaveBeenCalled();
    expect(resizeObservedElements).toContain(mockContainer);
  });

  it("should scroll to bottom on resize when at bottom", () => {
    // At bottom: scrollTop(500) + clientHeight(500) = scrollHeight(1000)
    mockContainer.scrollTop = 500;

    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });

    expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
  });

  it("should scroll to bottom when container shrinks (input grows) even if IntersectionObserver fired first", () => {
    // At bottom: scrollTop(800) + clientHeight(300) = scrollHeight(1100)
    mockContainer.scrollTop = 800;
    setDim(mockContainer, "clientHeight", 300);
    setDim(mockContainer, "scrollHeight", 1100);

    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    // IntersectionObserver fires first and clears the bottom state (WKWebView ordering)
    act(() => {
      observerCallbacks[0](
        [
          {
            isIntersecting: false,
            target: mockEndElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    // Input bar grows — container clientHeight shrinks, scrollHeight unchanged
    setDim(mockContainer, "clientHeight", 250);

    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });

    expect(mockContainer.scrollTop).toBe(1100);
  });

  it("should not scroll to bottom on container shrink when user was scrolled up", () => {
    // Not at bottom: scrollTop(300) + clientHeight(300) = 600 < scrollHeight(1100)
    mockContainer.scrollTop = 300;
    setDim(mockContainer, "clientHeight", 300);
    setDim(mockContainer, "scrollHeight", 1100);

    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    setDim(mockContainer, "clientHeight", 250);

    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });

    expect(mockContainer.scrollTop).toBe(300);
  });

  it("should not scroll on resize when user is scrolled up", () => {
    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    // Simulate being scrolled up via IntersectionObserver
    act(() => {
      observerCallbacks[0](
        [
          {
            isIntersecting: false,
            target: mockEndElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    mockContainer.scrollTop = 200;

    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });

    expect(mockContainer.scrollTop).toBe(200);
  });

  it("should re-stick to bottom across a reply-banner appear/disappear cycle", () => {
    // At bottom: scrollTop(700) + clientHeight(300) = scrollHeight(1000)
    mockContainer.scrollTop = 700;
    setDim(mockContainer, "clientHeight", 300);
    setDim(mockContainer, "scrollHeight", 1000);

    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    // Banner appears — container shrinks by 50px
    setDim(mockContainer, "clientHeight", 250);
    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });
    // Was at bottom (700 + 300 = 1000) → scrolled to bottom with new height
    expect(mockContainer.scrollTop).toBe(1000);

    // Simulate being at bottom with banner present (scrollHeight - 250 = 750)
    mockContainer.scrollTop = 750;

    // Banner disappears — container grows back to 300
    setDim(mockContainer, "clientHeight", 300);
    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });
    // Was at bottom (750 + 250 = 1000) → scrolled to bottom again
    expect(mockContainer.scrollTop).toBe(1000);
  });

  it("should not scroll when user was scrolled up when banner appeared", () => {
    // Scrolled up: scrollTop(200) + clientHeight(300) = 500 < scrollHeight(1000)
    mockContainer.scrollTop = 200;
    setDim(mockContainer, "clientHeight", 300);
    setDim(mockContainer, "scrollHeight", 1000);

    renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    // Banner appears — container shrinks
    setDim(mockContainer, "clientHeight", 250);
    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });
    // Was NOT at bottom → scrollTop unchanged
    expect(mockContainer.scrollTop).toBe(200);

    // Banner disappears
    setDim(mockContainer, "clientHeight", 300);
    act(() => {
      resizeObserverCallbacks[0]([], {} as ResizeObserver);
    });
    // Still not at bottom → scrollTop unchanged
    expect(mockContainer.scrollTop).toBe(200);
  });

  it("should discard IO callback when display:none collapses dims so wasAtBottomRef stays true", () => {
    // wasAtBottomRef starts true. When a keep-alive channel goes display:none, IO fires
    // isIntersecting:false while all dims are 0. isScrolledToBottom(container) returns true
    // (0-0-0 < tolerance), so without the guard we'd wrongly set wasAtBottomRef=false and
    // break auto-scroll when the channel becomes visible again.
    const { result } = renderHook(() => {
      const containerRef = useRef(mockContainer);
      const endElementRef = useRef(mockEndElement);
      return useScrollToBottom(containerRef, endElementRef);
    });

    // Collapse all dims — display:none
    setDim(mockContainer, "clientHeight", 0);
    setDim(mockContainer, "scrollHeight", 0);
    mockContainer.scrollTop = 0;

    act(() => {
      observerCallbacks[0](
        [
          {
            isIntersecting: false,
            target: mockEndElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    expect(result.current.wasAtBottomRef.current).toBe(true);
  });
});
