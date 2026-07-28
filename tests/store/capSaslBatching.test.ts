import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IRCClient } from "../../src/lib/irc/IRCClient";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";
import * as storage from "../../src/store/localStorage";

// A long CAP REQ is split into batches and the server ACKs in pieces, so a
// later ACK line can carry only non-sasl caps while SASL is still mid-exchange.
// The CAP-ACK handler must not end negotiation on that line, or the pending
// AUTHENTICATE reply is stranded and the login times out (never registers).
describe("CAP ACK — split-batch SASL does not end negotiation early", () => {
  const serverId = "srv-cap";
  let sent: string[];
  let origSendRaw: typeof ircClient.sendRaw;

  beforeEach(() => {
    ircClient.capNegotiationComplete.delete(serverId);
    sent = [];
    origSendRaw = ircClient.sendRaw.bind(ircClient);
    ircClient.sendRaw = (_id: string, line: string) => {
      sent.push(line);
    };
    // sasl was acknowledged on an earlier ACK line (accumulated capability).
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
          capabilities: ["sasl", "away-notify"],
        },
      ],
      pendingRegistration: null,
      ui: { ...useStore.getState().ui, linkSecurityWarnings: [] },
    } as unknown as AppState);
    vi.spyOn(storage.servers, "load").mockReturnValue([
      { id: serverId, saslEnabled: true, saslPassword: btoa("pw") },
      // biome-ignore lint/suspicious/noExplicitAny: minimal saved-server stub
    ] as any);
  });

  afterEach(() => {
    ircClient.sendRaw = origSendRaw;
    vi.restoreAllMocks();
  });

  test("a later non-sasl ACK line during pending SASL does not send CAP END", () => {
    ircClient.triggerEvent("CAP ACK", {
      serverId,
      cliCaps: "draft/bot-cmds",
    });
    expect(sent).not.toContain("CAP END");
    expect(ircClient.capNegotiationComplete.get(serverId)).not.toBe(true);
  });

  test("with no sasl acknowledged, a plain ACK still ends negotiation", () => {
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
          capabilities: ["away-notify"],
        },
      ],
    } as unknown as AppState);
    vi.spyOn(storage.servers, "load").mockReturnValue([]);
    ircClient.triggerEvent("CAP ACK", {
      serverId,
      cliCaps: "away-notify",
    });
    expect(sent).toContain("CAP END");
  });
});

// A server may ACK a multi-batch CAP REQ in any number of lines, so completion
// is tracked by which requested caps are still outstanding.
describe("IRCClient.onCapAck — completion tracking", () => {
  function makeClient() {
    const client = new IRCClient();
    const sent: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: stub the raw send for assertion
    (client as any).sendRaw = (_id: string, line: string) => sent.push(line);
    // biome-ignore lint/suspicious/noExplicitAny: registration is out of scope here
    (client as any).userOnConnect = vi.fn();
    return { client, sent };
  }

  test("does not end negotiation until every requested cap is acknowledged", () => {
    const { client, sent } = makeClient();
    // biome-ignore lint/suspicious/noExplicitAny: seed the pending set directly
    (client as any).pendingCapReqs.set("s1", new Set(["away-notify", "batch"]));

    client.onCapAck("s1", "away-notify");
    expect(sent).not.toContain("CAP END");

    client.onCapAck("s1", "batch");
    expect(sent).toContain("CAP END");
  });

  test("stores bare capability names when the server echoes values", () => {
    const { client } = makeClient();
    // biome-ignore lint/suspicious/noExplicitAny: minimal server stub
    (client as any).servers.set("s1", { id: "s1", capabilities: [] } as any);

    client.onCapAck("s1", "sasl=PLAIN away-notify ");

    // biome-ignore lint/suspicious/noExplicitAny: reading the stub back
    expect((client as any).servers.get("s1").capabilities).toEqual([
      "sasl",
      "away-notify",
    ]);
  });
});
