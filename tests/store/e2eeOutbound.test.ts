import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { E2EESessionState } from "../../src/lib/e2ee/session";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import { routeOutgoingPM } from "../../src/store/handlers/e2eeOutbound";
import type { Server } from "../../src/types";

// routeOutgoingPM is the single choke point every outgoing-PM path funnels
// through (composer hook + store action). The security invariant: whenever a
// session is engaged it must consume the message ("sent"/"withheld", never
// "none") so no caller falls back to a plaintext send, and it must never itself
// emit plaintext.

const SERVER_ID = "srv1";
const PM_ID = "pm-bob";
const NICK = "bob";

function seedPmServer(): void {
  const server = {
    id: SERVER_ID,
    privateChats: [{ id: PM_ID, username: NICK }],
    channels: [],
  } as unknown as Server;
  useStore.setState({ servers: [server] });
}

function setSession(state: E2EESessionState | undefined): void {
  useStore.setState({
    e2eeSessions: state ? { [`${SERVER_ID}:${NICK}`]: state } : {},
  });
}

describe("routeOutgoingPM choke point", () => {
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;
  let sendRawSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seedPmServer();
    sendMessageSpy = vi
      .spyOn(ircClient, "sendMessage")
      .mockImplementation(() => {});
    sendRawSpy = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
  });

  afterEach(() => {
    sendMessageSpy.mockRestore();
    sendRawSpy.mockRestore();
    useStore.setState({ servers: [], e2eeSessions: {}, messages: {} });
  });

  test("consumes the message when an Obby session is established", () => {
    setSession({
      status: "established",
      scheme: "obby",
      verified: true,
      peerFingerprint: "fp",
    });
    expect(routeOutgoingPM(SERVER_ID, NICK, "secret")).toBe("sent");
    // Never the plaintext path; an encrypted send (if any) rides sendRaw TAGMSG.
    expect(sendMessageSpy).not.toHaveBeenCalled();
    for (const call of sendRawSpy.mock.calls)
      expect(String(call[1])).not.toContain("PRIVMSG");
  });

  test("consumes the message when an OTR session is established", () => {
    setSession({
      status: "established",
      scheme: "otr",
      verified: false,
      peerFingerprint: "fp",
    });
    expect(routeOutgoingPM(SERVER_ID, NICK, "secret")).toBe("sent");
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test("withholds + warns while negotiating (no plaintext, visible notice)", () => {
    setSession({ status: "negotiating", scheme: "obby", initiator: true });
    expect(routeOutgoingPM(SERVER_ID, NICK, "secret")).toBe("withheld");
    expect(sendMessageSpy).not.toHaveBeenCalled();
    const rows = useStore.getState().messages[`${SERVER_ID}-${PM_ID}`] ?? [];
    expect(rows.some((m) => m.tags?.["e2ee-notice"] === "warning")).toBe(true);
  });

  test("declines when there is no session", () => {
    setSession(undefined);
    expect(routeOutgoingPM(SERVER_ID, NICK, "hello")).toBe("none");
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test("declines after a failed handshake (error state sends in clear)", () => {
    setSession({ status: "error", reason: "no-response" });
    expect(routeOutgoingPM(SERVER_ID, NICK, "hello")).toBe("none");
  });
});
