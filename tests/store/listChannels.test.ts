import { beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const serverId = "srv-list";

function setServer(isRegistered: boolean) {
  const server: Server = {
    id: serverId,
    name: "s",
    host: "irc.example.com",
    port: 443,
    channels: [],
    privateChats: [],
    isConnected: true,
    isRegistered,
    users: [],
  };
  useStore.setState({ servers: [server], listingInProgress: {} });
}

describe("listChannels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("waits for registration so the list never hangs on a LIST the server ignored", () => {
    const list = vi
      .spyOn(ircClient, "listChannels")
      .mockImplementation(() => {});
    setServer(false);

    useStore.getState().listChannels(serverId);

    expect(list).not.toHaveBeenCalled();
    expect(useStore.getState().listingInProgress[serverId]).toBeUndefined();
  });

  test("sends LIST once the server registered us", () => {
    const list = vi
      .spyOn(ircClient, "listChannels")
      .mockImplementation(() => {});
    setServer(true);

    useStore.getState().listChannels(serverId);

    expect(list).toHaveBeenCalled();
    expect(useStore.getState().listingInProgress[serverId]).toBe(true);
  });
});
