import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PageShell,
  stepBackWithinPage,
} from "../../../src/components/ui/page/PageShell";
import useStore from "../../../src/store";

const sections = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

describe("PageShell back on a phone", () => {
  beforeEach(() => {
    const state = useStore.getState();
    useStore.setState({ ui: { ...state.ui, isNarrowView: true, page: null } });
  });

  it("steps from a section to the section list, then lets the page close", () => {
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

    let isHandled = false;
    act(() => {
      isHandled = stepBackWithinPage();
    });
    expect(isHandled).toBe(true);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta body")).not.toBeInTheDocument();

    expect(stepBackWithinPage()).toBe(false);
  });
});
