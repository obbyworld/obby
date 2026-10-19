import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXIT_HINT_COMMAND,
  EXIT_WINDOW_MS,
  useBackButton,
} from "../../src/hooks/useBackButton";
import * as platform from "../../src/lib/platformUtils";
import useStore from "../../src/store";

const hintCount = () =>
  useStore
    .getState()
    .globalNotifications.filter((n) => n.command === EXIT_HINT_COMMAND).length;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useStore.getState().clearGlobalNotifications();
});

describe("useBackButton", () => {
  it("asks for a second press on android before it leaves", () => {
    vi.spyOn(platform, "isTauriAndroid").mockReturnValue(true);
    let isNothingOpen = false;
    renderHook(() => useBackButton(() => isNothingOpen));
    const press = () => window.androidBackCallback?.();

    expect(press()).toBe(false);
    expect(hintCount()).toBe(0);

    isNothingOpen = true;
    expect(press()).toBe(false);
    expect(hintCount()).toBe(1);
    expect(press()).toBe(true);
  });

  it("turns a browser back into a back press and lets the second one leave", () => {
    vi.useFakeTimers();
    vi.spyOn(platform, "isTauri").mockReturnValue(false);
    vi.spyOn(platform, "isMobileDevice").mockReturnValue(true);
    const pushState = vi.spyOn(window.history, "pushState");
    let isNothingOpen = false;
    renderHook(() => useBackButton(() => isNothingOpen));
    const pop = () =>
      act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    expect(pushState).toHaveBeenCalledTimes(1);

    pop();
    expect(pushState).toHaveBeenCalledTimes(2);

    isNothingOpen = true;
    pop();
    expect(hintCount()).toBe(1);
    expect(pushState).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS);
    });
    expect(pushState).toHaveBeenCalledTimes(3);
  });
});
