import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSIBLE_MAX_LINES,
  CollapsibleMessage,
} from "../../src/components/message/CollapsibleMessage";

function mockTouchInput() {
  const touchQuery: Partial<MediaQueryList> = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        ...touchQuery,
        matches: query === "(pointer: coarse)",
      }) as MediaQueryList,
  );
}

describe("CollapsibleMessage", () => {
  const LINE_HEIGHT = 20;
  let mockScrollHeight = 0;

  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          lineHeight: `${LINE_HEIGHT}px`,
          getPropertyValue: () => "",
        }) as unknown as CSSStyleDeclaration,
    );

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return mockScrollHeight;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockScrollHeight = 0;
  });

  it("does not show button when content fits within the line limit", () => {
    mockScrollHeight = LINE_HEIGHT * COLLAPSIBLE_MAX_LINES; // exactly at threshold
    render(<CollapsibleMessage content={<p>Short content</p>} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Show more when content exceeds the line limit", () => {
    mockScrollHeight = LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1); // one line over
    render(<CollapsibleMessage content={<p>Long content</p>} />);
    expect(
      screen.getByRole("button", { name: /Show more/ }),
    ).toBeInTheDocument();
  });

  it("unfolds in place and offers Show less", () => {
    mockScrollHeight = LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1);
    const { container } = render(
      <CollapsibleMessage content={<p>Long content</p>} />,
    );

    const contentDiv = container.querySelector(
      ".overflow-hidden",
    ) as HTMLElement;
    expect(contentDiv.style.maxHeight).toBe(
      `${LINE_HEIGHT * COLLAPSIBLE_MAX_LINES}px`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));

    expect(contentDiv.style.maxHeight).toBe(
      `${LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1)}px`,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show less/ }));
    expect(contentDiv.style.maxHeight).toBe(
      `${LINE_HEIGHT * COLLAPSIBLE_MAX_LINES}px`,
    );
  });

  it("uses px units (not em) for collapsed height", () => {
    mockScrollHeight = LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1);
    const { container } = render(
      <CollapsibleMessage content={<p>Long content</p>} />,
    );

    const contentDiv = container.querySelector(
      ".overflow-hidden",
    ) as HTMLElement;
    expect(contentDiv.style.maxHeight).toMatch(/^\d+px$/);
  });

  it("asks its owner to open the whole message on touch", () => {
    mockTouchInput();
    mockScrollHeight = LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1);
    const onRequestRead = vi.fn();
    render(
      <CollapsibleMessage
        content={<p>Long content</p>}
        onRequestRead={onRequestRead}
      />,
    );

    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Read all/ }));
    expect(onRequestRead).toHaveBeenCalledOnce();
  });

  it("unfolds in place on touch when nothing can open it", () => {
    mockTouchInput();
    mockScrollHeight = LINE_HEIGHT * (COLLAPSIBLE_MAX_LINES + 1);
    render(<CollapsibleMessage content={<p>Long content</p>} />);
    expect(
      screen.getByRole("button", { name: /Show more/ }),
    ).toBeInTheDocument();
  });
});
