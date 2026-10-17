import { beforeEach, describe, expect, test } from "vitest";
import { IRC_DISPATCH } from "../../src/lib/irc/handlers";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const serverId = "srv-sasl";
const server = () => useStore.getState().servers.find((s) => s.id === serverId);

describe("SASL rejection", () => {
  beforeEach(() => {
    ircClient.sendRaw = () => {};
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
        },
      ],
    } as unknown as AppState);
  });

  test("904 marks the server as signed in as a guest until we reconnect", () => {
    IRC_DISPATCH["904"](
      ircClient,
      serverId,
      "irc.example.com",
      ["me", "SASL authentication failed"],
      undefined,
      "SASL authentication failed",
    );
    expect(server()?.saslFailed).toBe(true);

    ircClient.triggerEvent("connectionStateChange", {
      serverId,
      connectionState: "connecting",
    });
    expect(server()?.saslFailed).toBe(false);
  });

  test("907 (already authenticated) is not a failed sign-in", () => {
    IRC_DISPATCH["907"](
      ircClient,
      serverId,
      "irc.example.com",
      ["me", "You have already authenticated"],
      undefined,
      "You have already authenticated",
    );
    expect(server()?.saslFailed).toBeFalsy();
  });
});
