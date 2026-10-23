import { describe, expect, it } from "vitest";
import {
  currentChatScope,
  isScopeOnServers,
  nicksInScope,
  resolveInScope,
  scopeLabel,
} from "../../../src/lib/search/searchScope";
import type { Server } from "../../../src/types";

const server = (id: string, name: string, channels: string[]): Server =>
  ({
    id,
    name,
    host: `${name}.test`,
    port: 6697,
    isConnected: true,
    users: [],
    privateChats: [{ id: `${id}-pm`, username: "carol" }],
    channels: channels.map((channelName, index) => ({
      id: `${id}-c${index}`,
      name: channelName,
      users: [{ id: "u", username: `${name}-user`, isOnline: true }],
    })),
  }) as unknown as Server;

const servers = [
  server("s1", "libera", ["#dev"]),
  server("s2", "oftc", ["#dev", "#ops"]),
];

describe("searchScope", () => {
  it("prefers a chat on the scoped network for in:", () => {
    expect(
      resolveInScope(servers, { kind: "network", serverId: "s2" }, "#DEV"),
    ).toEqual({ kind: "chat", serverId: "s2", target: "#dev" });
    expect(resolveInScope(servers, { kind: "everywhere" }, "oftc")).toEqual({
      kind: "network",
      serverId: "s2",
    });
    expect(resolveInScope(servers, { kind: "everywhere" }, "#nope")).toBeNull();
  });

  it("lists nicks of the scoped network plus saved senders", () => {
    expect(
      nicksInScope(servers, { kind: "network", serverId: "s1" }, ["zed"]),
    ).toEqual(["carol", "libera-user", "zed"]);
  });

  it("scopes to the selected chat, else its network", () => {
    expect(
      currentChatScope(servers, "s2", {
        selectedChannelId: "s2-c1",
        selectedPrivateChatId: null,
      }),
    ).toEqual({ kind: "chat", serverId: "s2", target: "#ops" });
    expect(currentChatScope(servers, "s1", null)).toEqual({
      kind: "network",
      serverId: "s1",
    });
    expect(currentChatScope(servers, null, null)).toEqual({
      kind: "everywhere",
    });
  });

  it("labels scopes and spots removed servers", () => {
    expect(scopeLabel({ kind: "network", serverId: "s1" }, servers)).toBe(
      "libera",
    );
    expect(
      isScopeOnServers({ kind: "network", serverId: "gone" }, servers),
    ).toBe(false);
    expect(isScopeOnServers({ kind: "everywhere" }, servers)).toBe(true);
  });
});
