import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import { serverSupportsMetadata } from "../../src/store/helpers";
import type { Server } from "../../src/types";

const serverId = "srv-caps";

const storeCaps = () =>
  useStore.getState().servers.find((s) => s.id === serverId)?.capabilities;

describe("store mirrors the client's capability list", () => {
  beforeEach(() => {
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    ircClient.capNegotiationComplete.set(serverId, true);
    ircClient.servers.set(serverId, {
      id: serverId,
      capabilities: [],
    } as unknown as Server);
    useStore.setState({
      servers: [
        {
          id: serverId,
          name: "s",
          host: "irc.example.com",
          port: 6697,
          channels: [],
          privateChats: [],
          isConnected: true,
          users: [],
          capabilities: ["setname", "draft/metadata-2"],
        },
      ],
    } as unknown as AppState);
  });

  afterEach(() => {
    ircClient.servers.delete(serverId);
    ircClient.capNegotiationComplete.delete(serverId);
    vi.restoreAllMocks();
  });

  test("replaces the stored list on ACK and DEL", () => {
    ircClient.onCapAck(serverId, "echo-message draft/metadata-2");
    expect(storeCaps()).toEqual(["echo-message", "draft/metadata-2"]);

    ircClient.onCapDel(serverId, "draft/metadata-2");
    expect(storeCaps()).toEqual(["echo-message"]);
    expect(serverSupportsMetadata(useStore.getState(), serverId)).toBe(false);
  });
});

describe("serverSupportsMetadata", () => {
  const stateWith = (capabilities: string[]) =>
    ({ servers: [{ id: serverId, capabilities }] }) as unknown as AppState;

  test("needs exactly draft/metadata-2", () => {
    expect(
      serverSupportsMetadata(stateWith(["draft/metadata-2"]), serverId),
    ).toBe(true);
    expect(
      serverSupportsMetadata(stateWith(["draft/metadata"]), serverId),
    ).toBe(false);
    expect(serverSupportsMetadata(stateWith([]), serverId)).toBe(false);
  });
});
