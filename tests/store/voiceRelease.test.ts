/** A voice/stream call outlives its React view on purpose (the pop-out card
 *  keeps it alive), so leaving a channel or losing a server has to be the
 *  thing that ends the call -- otherwise it keeps running with nothing left
 *  showing it. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import * as voice from "../../src/lib/voice";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import type { Channel } from "../../src/types";

vi.mock("../../src/lib/voice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/voice")>();
  return {
    ...actual,
    releaseVoiceClient: vi.fn(),
    releaseServerVoiceClients: vi.fn(),
  };
});

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-1",
    name: "#test",
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: [],
    ...overrides,
  };
}

function setupServer() {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [makeChannel()],
        privateChats: [],
        isConnected: true,
        connectionState: "connected" as const,
        users: [],
      },
    ],
    messages: {},
    activeBatches: {},
    globalSettings: {
      showEvents: true,
      showJoinsParts: true,
    },
  } as unknown as AppState);
}

describe("voice call release on channel/server teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupServer();
    vi.spyOn(ircClient, "leaveChannel").mockImplementation(() => {});
    vi.spyOn(ircClient, "disconnect").mockImplementation(() => {});
    vi.spyOn(ircClient, "removeServer").mockImplementation(() => {});
  });

  it("leaveChannel releases only that channel's voice client", () => {
    useStore.getState().leaveChannel("srv-1", "#test");

    expect(voice.releaseVoiceClient).toHaveBeenCalledWith("srv-1", "#test");
    expect(voice.releaseServerVoiceClients).not.toHaveBeenCalled();
  });

  it("disconnect releases every voice client on that server", () => {
    useStore.getState().disconnect("srv-1");

    expect(voice.releaseServerVoiceClients).toHaveBeenCalledWith("srv-1");
  });

  it("deleteServer releases every voice client on that server", () => {
    useStore.getState().deleteServer("srv-1");

    expect(voice.releaseServerVoiceClients).toHaveBeenCalledWith("srv-1");
  });
});
