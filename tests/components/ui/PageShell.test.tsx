import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  goBackInPage,
  PageShell,
} from "../../../src/components/ui/page/PageShell";
import useStore from "../../../src/store";

const sections = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

describe("PageShell back on a phone", () => {
  beforeEach(() => {
    const state = useStore.getState();
    useStore.setState({
      ui: {
        ...state.ui,
        isNarrowView: true,
        mobileViewActiveColumn: "serverList",
        page: null,
      },
    });
  });

  it("steps from a section to the section list, then closes the page", () => {
    act(() => useStore.getState().openPage({ kind: "settings" }));
    render(
      <PageShell
        title="Settings"
        sections={sections}
        activeSection="b"
        startOnSection
      >
        <p>beta body</p>
      </PageShell>,
    );
    expect(screen.getByText("beta body")).toBeInTheDocument();

    act(() => {
      expect(goBackInPage()).toBe(true);
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta body")).not.toBeInTheDocument();
    expect(useStore.getState().ui.page).toEqual({ kind: "settings" });

    act(() => {
      expect(goBackInPage()).toBe(true);
    });
    expect(useStore.getState().ui.page).toBeNull();
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("serverList");
  });

  it("goes back where a sub-page says", () => {
    let wentBack = false;
    render(
      <PageShell
        title="Two-factor"
        back={{ label: "Settings", onBack: () => (wentBack = true) }}
      >
        <p>body</p>
      </PageShell>,
    );
    act(() => {
      goBackInPage();
    });
    expect(wentBack).toBe(true);
  });

  it("has nothing to step back to without a page", () => {
    expect(goBackInPage()).toBe(false);
  });
});
