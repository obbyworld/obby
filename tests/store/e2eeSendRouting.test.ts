import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { E2EESessionState } from "../../src/lib/e2ee/session";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

// sendMessage is the single choke point that must never leak plaintext to a peer
// the user believes is encrypted: mid-handshake (negotiating/pending-accept) and
// after a flagged key change, the outgoing PM must be dropped, not sent in clear.
// When there is no active session it must send normally. (The established paths
// hand off to the per-scheme backends, covered by the backend tests.)

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

describe("sendMessage E2EE routing", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seedPmServer();
    sendSpy = vi.spyOn(ircClient, "sendMessage").mockImplementation(() => {});
  });

  afterEach(() => {
    sendSpy.mockRestore();
    useStore.setState({ servers: [], e2eeSessions: {} });
  });

  test("drops the message while negotiating (no plaintext leak)", () => {
    setSession({ status: "negotiating", scheme: "otr", initiator: true });
    useStore.getState().sendMessage(SERVER_ID, PM_ID, "secret");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("drops the message while an offer is pending accept", () => {
    setSession({
      status: "pending-accept",
      scheme: "obby",
      peerFingerprint: "fp",
    });
    useStore.getState().sendMessage(SERVER_ID, PM_ID, "secret");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("drops the message after a key change", () => {
    setSession({
      status: "key-changed",
      scheme: "otr",
      oldFingerprint: "a",
      newFingerprint: "b",
    });
    useStore.getState().sendMessage(SERVER_ID, PM_ID, "secret");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("sends plaintext when there is no session", () => {
    setSession(undefined);
    useStore.getState().sendMessage(SERVER_ID, PM_ID, "hello");
    expect(sendSpy).toHaveBeenCalledWith(SERVER_ID, PM_ID, "hello");
  });

  test("sends plaintext after a failed handshake (error state falls back)", () => {
    setSession({ status: "error", reason: "no response from peer" });
    useStore.getState().sendMessage(SERVER_ID, PM_ID, "hello");
    expect(sendSpy).toHaveBeenCalledWith(SERVER_ID, PM_ID, "hello");
  });
});
