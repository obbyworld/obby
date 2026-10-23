import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  ChannelLink,
  type ChannelLinkApi,
  ChannelLinkContext,
} from "../../src/components/message/ChannelLink";

function renderWith(api: ChannelLinkApi | null, name: string) {
  return render(
    <ChannelLinkContext.Provider value={api}>
      <ChannelLink name={name} />
    </ChannelLinkContext.Provider>,
  );
}

const knownApi = (open = vi.fn()): ChannelLinkApi => ({
  isKnown: (name) => name === "#general",
  open,
});

describe("ChannelLink", () => {
  test("a known channel is a button", () => {
    const { container } = renderWith(knownApi(), "#general");
    expect(container.querySelector("button")).toBeTruthy();
    expect(container.textContent).toBe("#general");
  });

  // Most `#word` in chat is prose, so an unknown name must not offer a click
  // that would join something the user never asked for.
  test("an unknown channel stays plain text", () => {
    const { container } = renderWith(knownApi(), "#hashtag");
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("#hashtag");
  });

  test("clicking a known channel opens it", () => {
    const open = vi.fn();
    const { container } = renderWith(knownApi(open), "#general");
    const button = container.querySelector("button");
    if (!button) throw new Error("expected a button");
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith("#general");
  });

  test("no provider means plain text", () => {
    const { container } = renderWith(null, "#general");
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("#general");
  });
});
