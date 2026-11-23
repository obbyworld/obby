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

  it("reveals a bidi control in the warning and opens the exact URL", () => {
    const url = "http://host/files/\u{202e}gpj.exe";
    render(
      <>
        <ExternalLinkGuard />
        <a href={url} className="external-link-security">
          spoof
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("spoof"));

    const shown = screen.getByText(/gpj\.exe/).textContent ?? "";
    expect(shown).toBe("http://host/files/%E2%80%AEgpj.exe");
    expect(shown).not.toMatch(/[\u{202a}-\u{202e}]/u);

    fireEvent.click(screen.getByText("Open Link"));
    expect(openExternalUrl).toHaveBeenCalledWith(url);
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
