import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageLayer } from "../../../src/components/layout/PageLayer";
import { PageShell } from "../../../src/components/ui/page/PageShell";
import useStore from "../../../src/store";

vi.mock("../../../src/components/pages/PageHost", () => ({
  default: () => (
    <PageShell
      title="Settings"
      sections={[
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ]}
      activeSection="b"
      startOnSection
    >
      <p>beta body</p>
    </PageShell>
  ),
}));

const swipeRight = (el: Element) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 5, clientY: 300 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 40, clientY: 302 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 220, clientY: 305 }] });
  fireEvent.touchEnd(el, { touches: [] });
};

describe("PageLayer on a phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const state = useStore.getState();
    useStore.setState({
      ui: {
        ...state.ui,
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
        page: { kind: "settings" },
      },
    });
  });

  it("steps back one level per swipe and returns to the column it covered", () => {
    const parentSwipe = vi.fn();
    render(
      <div onTouchStart={parentSwipe}>
        <PageLayer page={{ kind: "settings" }} />
      </div>,
    );

    swipeRight(screen.getByText("beta body"));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    swipeRight(screen.getByText("Alpha"));
    expect(useStore.getState().ui.page).toBeNull();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
    expect(parentSwipe).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
