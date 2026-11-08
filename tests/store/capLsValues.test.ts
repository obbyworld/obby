import { describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const serverId = "srv-caps";

describe("CAP LS values", () => {
  test("keeps every advertised cap value on the store's server", () => {
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    const server: Server = {
      id: serverId,
      name: "s",
      host: "irc.example.com",
      port: 443,
      channels: [],
      privateChats: [],
      users: [],
      isConnected: true,
    };
    useStore.setState({ servers: [server] });

    ircClient.onCapLs(
      serverId,
      "sasl=PLAIN,EXTERNAL draft/account-registration=before-connect,email-required unrealircd.org/link-security=2 echo-message",
      true,
    );

    const stored = useStore.getState().servers[0];
    expect(stored.capabilityValues).toMatchObject({
      sasl: "PLAIN,EXTERNAL",
      "draft/account-registration": "before-connect,email-required",
    });
    expect(stored.capabilityValues).not.toHaveProperty(
      "unrealircd.org/link-security",
    );
    expect(stored.linkSecurity).toBe(2);
  });
});
