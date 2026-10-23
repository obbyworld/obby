import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const me = { id: "me-id", username: "me", isOnline: true };

describe("our own metadata", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "getNick").mockReturnValue("me");
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue({ ...me });
    useStore.setState({
      currentUser: { ...me },
      ui: { ...useStore.getState().ui, selectedServerId: "own-meta" },
      servers: [
        {
          id: "own-meta",
          name: "TestServer",
          host: "irc.example.com",
          port: 6667,
          channels: [
            {
              id: "chan-1",
              name: "#test",
              serverId: "own-meta",
              isPrivate: false,
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [{ ...me }],
            },
          ],
          privateChats: [],
          users: [],
          isConnected: true,
        },
      ],
    } as Partial<AppState>);
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps every key on our profile when one key changes", () => {
    for (const [key, value] of [
      ["avatar", "https://example.com/a.png"],
      ["display-name", "Me"],
      ["color", "#00ff00"],
    ]) {
      ircClient.triggerEvent("METADATA", {
        serverId: "own-meta",
        target: "me",
        key,
        visibility: "*",
        value,
      });
    }

    const state = useStore.getState();
    const values = (metadata = {}) =>
      Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [
          k,
          (v as { value: string }).value,
        ]),
      );
    const expected = {
      avatar: "https://example.com/a.png",
      "display-name": "Me",
      color: "#00ff00",
    };
    expect(values(state.currentUser?.metadata)).toEqual(expected);
    expect(values(state.servers[0].channels[0].users[0].metadata)).toEqual(
      expected,
    );
  });
});
