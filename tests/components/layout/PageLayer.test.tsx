import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageLayer } from "../../../src/components/layout/PageLayer";
import { PageShell } from "../../../src/components/ui/page/PageShell";
import useStore from "../../../src/store";
import type { AppPage } from "../../../src/store/types";

vi.mock("../../../src/components/pages/PageHost", () => ({
  parentPageOf: (page: AppPage) =>
    page.kind === "twoFactor" ? { kind: "settings" } : null,
  default: ({ page }: { page: AppPage }) =>
    page.kind === "twoFactor" ? (
      <PageShell title="Two-factor">
        <p>2fa body</p>
      </PageShell>
    ) : (
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

const SLIDE_MS = 220;

const dragRight = (el: Element, toX: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 5, clientY: 300 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 40, clientY: 302 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: toX, clientY: 305 }] });
};

const release = (el: Element) => fireEvent.touchEnd(el, { touches: [] });

const openPage = (page: AppPage) => {
  const state = useStore.getState();
  useStore.setState({
    ui: {
      ...state.ui,
      isNarrowView: true,
      mobileViewActiveColumn: "serverList",
      page,
    },
  });
};

describe("PageLayer on a phone", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uncovers the section list under a section while dragging, and lands there after the slide", () => {
    openPage({ kind: "settings" });
    render(<PageLayer page={{ kind: "settings" }} />);
    expect(screen.queryByText("Alpha")).toBeNull();

    dragRight(screen.getByText("beta body"), 600);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("beta body")).toBeInTheDocument();

    release(screen.getByText("beta body"));
    expect(screen.getByText("beta body")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SLIDE_MS));
    expect(screen.queryByText("beta body")).toBeNull();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(useStore.getState().ui.page).not.toBeNull();
  });

  it("closes from the section list only after its slide, back to the column it covered", () => {
    openPage({ kind: "settings" });
    const parentSwipe = vi.fn();
    render(
      <div onTouchStart={parentSwipe}>
        <PageLayer page={{ kind: "settings" }} />
      </div>,
    );
    dragRight(screen.getByText("beta body"), 600);
    release(screen.getByText("beta body"));
    act(() => vi.advanceTimersByTime(SLIDE_MS));

    dragRight(screen.getByText("Alpha"), 600);
    release(screen.getByText("Alpha"));
    expect(useStore.getState().ui.page).not.toBeNull();
    act(() => vi.advanceTimersByTime(SLIDE_MS));
    expect(useStore.getState().ui.page).toBeNull();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
    expect(parentSwipe).not.toHaveBeenCalled();
  });

  it("uncovers a sub-page's parent page and returns to it", () => {
    openPage({ kind: "twoFactor", serverId: "s" });
    render(<PageLayer page={{ kind: "twoFactor", serverId: "s" }} />);

    dragRight(screen.getByText("2fa body"), 600);
    expect(screen.getByText("beta body")).toBeInTheDocument();
    release(screen.getByText("2fa body"));
    act(() => vi.advanceTimersByTime(SLIDE_MS));
    expect(useStore.getState().ui.page).toEqual({ kind: "settings" });
  });

  it("ignores a leftward drag", () => {
    openPage({ kind: "settings" });
    render(<PageLayer page={{ kind: "settings" }} />);
    const body = screen.getByText("beta body");
    fireEvent.touchStart(body, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchMove(body, { touches: [{ clientX: 100, clientY: 302 }] });
    release(body);
    act(() => vi.advanceTimersByTime(SLIDE_MS));
    expect(screen.getByText("beta body")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});
