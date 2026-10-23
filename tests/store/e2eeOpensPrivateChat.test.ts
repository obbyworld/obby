import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  encodeE2EEPayload,
  PROTOCOL_VERSION,
} from "../../src/lib/e2ee/protocol";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import { registerE2EEHandlers } from "../../src/store/handlers/e2ee";
import { handleInboundOtr } from "../../src/store/handlers/otr";

// Every encryption affordance (offer banner, lock, verify prompt) renders inside
// the PM thread. A peer can open a session before either side has ever sent a
// message, so an inbound control frame has to create the thread or the request
// is invisible and unacceptable.
const serverId = "s1";

function privateChats() {
  return (
    useStore.getState().servers.find((s) => s.id === serverId)?.privateChats ??
    []
  );
}

function seedServer() {
  useStore.setState({
    servers: [
      {
        id: serverId,
        name: "test",
        host: "irc.test",
        port: 443,
        channels: [],
        privateChats: [],
        isConnected: true,
        users: [],
      } as never,
    ],
    e2eeSessions: {},
  });
}

describe("an inbound encryption request opens the conversation", () => {
  beforeEach(() => {
    seedServer();
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    registerE2EEHandlers(useStore);
  });

  test("an Obby offer from a stranger creates the PM thread", () => {
    expect(privateChats()).toHaveLength(0);

    ircClient.triggerEvent("TAGMSG", {
      mtags: {
        "+obby.world/e2ee": encodeE2EEPayload({
          t: "init",
          v: PROTOCOL_VERSION,
          bundle: "not-a-real-bundle",
        }),
      },
      serverId,
      sender: "stranger",
    } as never);

    expect(privateChats().map((p) => p.username)).toContain("stranger");
  });

  test("an OTR query from a stranger creates the PM thread", () => {
    expect(privateChats()).toHaveLength(0);

    const consumed = handleInboundOtr(serverId, "otrpeer", "?OTRv23?");

    expect(consumed).toBe(true);
    expect(privateChats().map((p) => p.username)).toContain("otrpeer");
  });
});
