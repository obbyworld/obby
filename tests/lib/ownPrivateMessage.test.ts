import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import { showOwnPrivateMessage } from "../../src/lib/ownPrivateMessage";
import useStore from "../../src/store";
import type { PrivateChat, User } from "../../src/types";

vi.mock("../../src/lib/ircClient", () => ({
  default: { on: vi.fn(), hasCapability: vi.fn() },
}));

const chat: PrivateChat = {
  id: "pm-bob",
  username: "bob",
  serverId: "s1",
  unreadCount: 0,
  isMentioned: false,
};
const me: User = { id: "me", username: "tester", isOnline: true };

describe("showOwnPrivateMessage", () => {
  beforeEach(() => {
    useStore.setState({ messages: {} });
  });

  it("leaves the PM to the server echo under echo-message", () => {
    vi.mocked(ircClient.hasCapability).mockImplementation(
      (_, cap) => cap === "echo-message",
    );
    showOwnPrivateMessage("s1", chat, me, "hi https://host/1.png", null);
    expect(useStore.getState().messages).toEqual({});
  });

  it("shows the PM locally when the server does not echo it", () => {
    vi.mocked(ircClient.hasCapability).mockReturnValue(false);
    showOwnPrivateMessage("s1", chat, me, "hi https://host/1.png", null);
    const all = Object.values(useStore.getState().messages).flat();
    expect(all.map((m) => m.content)).toEqual(["hi https://host/1.png"]);
  });
});
