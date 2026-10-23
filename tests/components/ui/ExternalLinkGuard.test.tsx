import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalLinkGuard } from "../../../src/components/ui/ExternalLinkGuard";

const openExternalUrl = vi.fn();
vi.mock("../../../src/lib/openUrl", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

afterEach(() => openExternalUrl.mockReset());

const link = (inWrapper: boolean) => (
  <div data-link-wrapper={inWrapper ? "" : undefined}>
    <a
      href="https://shop.example.com"
      target="_blank"
      rel="noreferrer"
      className="external-link-security"
    >
      shop.example.com
    </a>
  </div>
);

describe("ExternalLinkGuard", () => {
  it("asks before opening a chat link that no wrapper handles", () => {
    render(
      <>
        <ExternalLinkGuard />
        {link(false)}
      </>,
    );
    const clicked = fireEvent.click(screen.getByText("shop.example.com"));

    expect(clicked).toBe(false);
    expect(screen.getByText("https://shop.example.com")).toBeTruthy();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("leaves links inside a link wrapper to the wrapper", () => {
    render(
      <>
        <ExternalLinkGuard />
        {link(true)}
      </>,
    );
    fireEvent.click(screen.getByText("shop.example.com"));

    expect(screen.queryByText("https://shop.example.com")).toBeNull();
  });
});
