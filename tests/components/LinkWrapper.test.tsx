import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnhancedLinkWrapper } from "../../src/components/ui/LinkWrapper";

describe("EnhancedLinkWrapper", () => {
  it("hands irc links to the irc handler", () => {
    const onIrcLinkClick = vi.fn();
    render(
      <EnhancedLinkWrapper onIrcLinkClick={onIrcLinkClick}>
        join ircs://irc.example.org/#lobby
      </EnhancedLinkWrapper>,
    );
    fireEvent.click(screen.getByText("ircs://irc.example.org/#lobby"));
    expect(onIrcLinkClick).toHaveBeenCalledWith(
      "ircs://irc.example.org/#lobby",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows web links compactly and opens them through the warning", () => {
    render(
      <EnhancedLinkWrapper>
        see https://www.example.org/docs/
      </EnhancedLinkWrapper>,
    );
    fireEvent.click(screen.getByText("example.org/docs"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
