import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TitleTooltipLayer from "../../../src/components/ui/TitleTooltipLayer";

const hover = (el: Element) =>
  fireEvent.pointerOver(el, { pointerType: "mouse" });

describe("TitleTooltipLayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a title as our tooltip and keeps the browser's own from showing", () => {
    render(
      <>
        <TitleTooltipLayer />
        <button type="button" title="Close search">
          <svg />
        </button>
      </>,
    );
    const button = screen.getByRole("button");

    hover(button);
    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Close search");
    expect(screen.getByRole("tooltip")).toHaveClass("tooltip-surface");
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAccessibleName("Close search");
  });

  it("hides on leave and on click", () => {
    render(
      <>
        <TitleTooltipLayer />
        <button type="button" title="Search">
          Search
        </button>
        <span>elsewhere</span>
      </>,
    );
    const button = screen.getByRole("button");

    hover(button);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerOut(button, {
      relatedTarget: screen.getByText("elsewhere"),
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    hover(screen.getByText("elsewhere"));
    hover(button);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerDown(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("follows the current title prop between hovers and closes on Escape", () => {
    const view = (title?: string) => (
      <>
        <TitleTooltipLayer />
        <button type="button" title={title}>
          Load
        </button>
        <span>elsewhere</span>
      </>
    );
    const { rerender } = render(view("Saved on this device"));
    const button = screen.getByRole("button");
    const leave = () =>
      fireEvent.pointerOut(button, {
        relatedTarget: screen.getByText("elsewhere"),
      });

    hover(button);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Saved on this device",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).toHaveAttribute("title", "Saved on this device");
    leave();

    rerender(view("From the server"));
    hover(button);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("From the server");
    leave();

    rerender(view(undefined));
    hover(button);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps an image's own name", () => {
    render(
      <>
        <TitleTooltipLayer />
        <img alt="cat.png" title="Open in viewer" src="data:," />
      </>,
    );
    const img = screen.getByRole("img");
    hover(img);
    act(() => vi.advanceTimersByTime(500));
    expect(img).toHaveAccessibleName("cat.png");
  });
});
