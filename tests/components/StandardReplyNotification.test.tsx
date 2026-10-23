import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StandardReplyNotification } from "../../src/components/ui/StandardReplyNotification";

vi.mock("../../src/lib/ircUtils", () => ({
  mircToHtml: vi.fn((text: string) => `<span>${text}</span>`),
  processMarkdownInText: vi.fn((text: string) => `<span>${text}</span>`),
}));

vi.mock("../../src/components/ui/LinkWrapper", () => ({
  EnhancedLinkWrapper: ({
    children,
    onIrcLinkClick,
  }: {
    children: React.ReactNode;
    onIrcLinkClick?: (url: string) => void;
  }) => (
    <div data-testid="enhanced-link-wrapper" data-onclick={!!onIrcLinkClick}>
      {children}
    </div>
  ),
}));

describe("StandardReplyNotification", () => {
  const mockOnIrcLinkClick = vi.fn();
  const baseProps = {
    command: "AUTHENTICATE",
    code: "INVALID_CREDENTIALS",
    message: "Authentication failed",
    timestamp: new Date("2023-01-01T12:00:00Z"),
  };

  test("renders the human-readable description as the body", () => {
    render(
      <StandardReplyNotification
        {...baseProps}
        type="FAIL"
        onIrcLinkClick={mockOnIrcLinkClick}
      />,
    );
    expect(screen.getByTestId("enhanced-link-wrapper")).toHaveTextContent(
      "Authentication failed",
    );
  });

  test("does NOT render command/code as visible text (computer-readable only)", () => {
    render(
      <StandardReplyNotification
        {...baseProps}
        type="FAIL"
        onIrcLinkClick={mockOnIrcLinkClick}
      />,
    );
    // Description text is what users see; command/code/type must not appear
    // in any visible label.
    expect(screen.queryByText(/AUTHENTICATE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/INVALID_CREDENTIALS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^FAIL$/)).not.toBeInTheDocument();
  });

  test("reads as a plain event row with only the failure text tinted red", () => {
    const { rerender } = render(
      <StandardReplyNotification {...baseProps} type="FAIL" />,
    );
    expect(
      screen.getByTestId("enhanced-link-wrapper").closest(".text-red-300"),
    ).not.toBeNull();
    rerender(<StandardReplyNotification {...baseProps} type="NOTE" />);
    expect(document.querySelector(".text-red-300")).toBeNull();
    expect(
      document.querySelector(
        "[class*='bg-red-'],[class*='bg-blue-'],[class*='border-']",
      ),
    ).toBeNull();
  });

  test("keeps context identifiers off the row and on its title", () => {
    render(
      <StandardReplyNotification
        {...baseProps}
        type="NOTE"
        context={["172.18.0.1", "*"]}
      />,
    );
    expect(screen.queryByText("172.18.0.1")).not.toBeInTheDocument();
    expect(document.querySelector("[title]")?.getAttribute("title")).toContain(
      "172.18.0.1",
    );
  });

  test("shows the code when the server sent no description", () => {
    render(<StandardReplyNotification {...baseProps} type="FAIL" message="" />);
    expect(screen.getByTestId("enhanced-link-wrapper")).toHaveTextContent(
      "INVALID_CREDENTIALS",
    );
  });

  test("exposes computer-readable info via the title attribute", () => {
    render(
      <StandardReplyNotification
        {...baseProps}
        type="FAIL"
        context={["#foo"]}
      />,
    );
    const card = document.querySelector("[title]") as HTMLElement | null;
    expect(card?.getAttribute("title")).toBe(
      "FAIL AUTHENTICATE INVALID_CREDENTIALS #foo",
    );
  });

  test("displays formatted timestamp", () => {
    const testDate = new Date("2023-01-01T15:30:00Z");
    render(
      <StandardReplyNotification
        {...baseProps}
        type="NOTE"
        timestamp={testDate}
      />,
    );
    const expected = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(testDate);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("passes onIrcLinkClick into EnhancedLinkWrapper", () => {
    render(
      <StandardReplyNotification
        {...baseProps}
        type="NOTE"
        onIrcLinkClick={mockOnIrcLinkClick}
      />,
    );
    const wrapper = screen.getByTestId("enhanced-link-wrapper");
    expect(wrapper).toHaveAttribute("data-onclick", "true");
  });

  test("works without onIrcLinkClick callback", () => {
    render(<StandardReplyNotification {...baseProps} type="FAIL" />);
    const wrapper = screen.getByTestId("enhanced-link-wrapper");
    expect(wrapper).toHaveAttribute("data-onclick", "false");
  });
});
