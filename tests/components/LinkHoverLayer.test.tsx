import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinkHoverLayer from "../../src/components/ui/LinkHoverLayer";

const URL = "https://example.org/some/long/path";

function hover(element: Element, pointerType: string) {
  const event = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    element.dispatchEvent(event);
  });
}

function renderLink() {
  render(
    <>
      <a className="external-link-security" href={URL}>
        Some page title
      </a>
      <LinkHoverLayer />
    </>,
  );
  return screen.getByText("Some page title");
}

describe("link hover card", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the raw address after a short mouse hover", () => {
    const link = renderLink();
    hover(link, "mouse");
    expect(screen.queryByText(URL)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText(URL)).toBeInTheDocument();
    expect(screen.getByText("example.org")).toBeInTheDocument();
  });

  it("stays open while the pointer moves onto the card", () => {
    const link = renderLink();
    hover(link, "mouse");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const out = new MouseEvent("pointerout", { bubbles: true });
    const card = screen.getByText(URL);
    Object.defineProperty(out, "relatedTarget", { value: card });
    act(() => {
      link.dispatchEvent(out);
    });
    hover(card, "mouse");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText(URL)).toBeInTheDocument();
  });

  it("closes shortly after the pointer leaves for empty space", () => {
    const link = renderLink();
    hover(link, "mouse");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const out = new MouseEvent("pointerout", { bubbles: true });
    Object.defineProperty(out, "relatedTarget", { value: document.body });
    act(() => {
      link.dispatchEvent(out);
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText(URL)).toBeNull();
  });

  it("closes when the hovered link leaves the page", () => {
    const page = (hasLink: boolean) => (
      <>
        {hasLink && (
          <a className="external-link-security" href={URL}>
            Some page title
          </a>
        )}
        <LinkHoverLayer />
      </>
    );
    const { rerender } = render(page(true));
    hover(screen.getByText("Some page title"), "mouse");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    rerender(page(false));
    hover(document.body, "mouse");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText(URL)).toBeNull();
  });

  it("stays closed for touch, which has no hover", () => {
    const link = renderLink();
    hover(link, "touch");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText(URL)).toBeNull();
  });
});
