import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypingIndicator } from "../../src/components/ui/TypingIndicator";
import type { User } from "../../src/types";

function makeTypingUser(username: string): User {
  return { id: username, username, isOnline: true };
}

let typingUsers: Record<string, User[]> = {};
let channelUsers: User[] = [];

vi.mock("../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        typingUsers,
        servers: [{ id: "s1", channels: [{ users: channelUsers }] }],
      };
      return selector(state);
    }),
    { getState: vi.fn(() => ({ typingUsers, servers: [] })) },
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
  typingUsers = {};
  channelUsers = [];
});

describe("TypingIndicator", () => {
  it("shows one typing user", () => {
    typingUsers = { "s1-c1": [makeTypingUser("alice")] };
    const { container } = render(
      <TypingIndicator serverId="s1" channelId="c1" />,
    );
    expect(container.textContent).toMatch(/^alice is typing\.\.\.$/);
  });

  it("shows two typing users", () => {
    typingUsers = {
      "s1-c1": [makeTypingUser("alice"), makeTypingUser("bob")],
    };
    const { container } = render(
      <TypingIndicator serverId="s1" channelId="c1" />,
    );
    expect(container.textContent).toMatch(/^alice and bob are typing\.\.\.$/);
  });

  it("shows three typing users", () => {
    typingUsers = {
      "s1-c1": [
        makeTypingUser("alice"),
        makeTypingUser("bob"),
        makeTypingUser("carol"),
      ],
    };
    const { container } = render(
      <TypingIndicator serverId="s1" channelId="c1" />,
    );
    expect(container.textContent).toMatch(
      /^alice, bob and carol are typing\.\.\.$/,
    );
  });

  it("shows three names plus a count of the others", () => {
    typingUsers = {
      "s1-c1": [
        makeTypingUser("alice"),
        makeTypingUser("bob"),
        makeTypingUser("carol"),
        makeTypingUser("dave"),
        makeTypingUser("erin"),
      ],
    };
    const { container } = render(
      <TypingIndicator serverId="s1" channelId="c1" />,
    );
    expect(container.textContent).toMatch(
      /^alice, bob, carol and 2 others are typing\.\.\.$/,
    );
  });

  it("renders a name with a metadata color inline", () => {
    channelUsers = [
      {
        id: "alice",
        username: "alice",
        isOnline: true,
        metadata: { color: { value: "#ff0000", visibility: "*" } },
      },
    ];
    typingUsers = { "s1-c1": [makeTypingUser("alice")] };
    render(<TypingIndicator serverId="s1" channelId="c1" />);
    expect(screen.getByText("alice")).toHaveStyle({ color: "#ff0000" });
  });

  it("renders a name with no metadata color with no inline color", () => {
    channelUsers = [makeTypingUser("bob")];
    typingUsers = { "s1-c1": [makeTypingUser("bob")] };
    render(<TypingIndicator serverId="s1" channelId="c1" />);
    const name = screen.getByText("bob");
    expect(name.style.color).toBe("");
  });
});
