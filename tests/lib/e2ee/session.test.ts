import { describe, expect, test } from "vitest";
import {
  type E2EEEvent,
  type E2EESessionState,
  INITIAL_SESSION,
  isEncrypting,
  reduceSession,
} from "../../../src/lib/e2ee/session";

const run = (events: E2EEEvent[], from = INITIAL_SESSION): E2EESessionState =>
  events.reduce(reduceSession, from);

describe("initiator handshake", () => {
  test("start then remote accept reaches established (unverified)", () => {
    const state = run([
      { type: "start", scheme: "obby" },
      { type: "accepted-remote", peerFingerprint: "FP", peerAccount: "bob" },
    ]);
    expect(state).toEqual({
      status: "established",
      scheme: "obby",
      verified: false,
      peerFingerprint: "FP",
      peerAccount: "bob",
    });
    expect(isEncrypting(state)).toBe(true);
  });

  test("remote reject ends in rejected", () => {
    const state = run([
      { type: "start", scheme: "otr" },
      { type: "rejected-remote" },
    ]);
    expect(state).toEqual({ status: "rejected", scheme: "otr" });
    expect(isEncrypting(state)).toBe(false);
  });
});

describe("responder handshake", () => {
  test("offer then local accept then established carries peer identity through", () => {
    const state = run([
      {
        type: "offer-received",
        scheme: "obby",
        peerFingerprint: "FP",
        peerAccount: "alice",
      },
      { type: "accept-local" },
      { type: "established" },
    ]);
    expect(state).toEqual({
      status: "established",
      scheme: "obby",
      verified: false,
      peerFingerprint: "FP",
      peerAccount: "alice",
    });
  });

  test("local reject ends in rejected", () => {
    const state = run([
      { type: "offer-received", scheme: "obby", peerFingerprint: "FP" },
      { type: "reject-local" },
    ]);
    expect(state).toEqual({ status: "rejected", scheme: "obby" });
  });
});

describe("verification and key change", () => {
  const established = run([
    { type: "start", scheme: "obby" },
    { type: "accepted-remote", peerFingerprint: "FP" },
  ]);

  test("verify flips the verified flag", () => {
    expect(reduceSession(established, { type: "verify" })).toMatchObject({
      status: "established",
      verified: true,
    });
  });

  test("key change blocks and is sticky until reset", () => {
    const changed = reduceSession(established, {
      type: "key-change",
      oldFingerprint: "FP",
      newFingerprint: "FP2",
    });
    expect(changed.status).toBe("key-changed");
    // No event other than reset moves it out of the blocked state.
    expect(reduceSession(changed, { type: "verify" })).toBe(changed);
    expect(reduceSession(changed, { type: "established" })).toBe(changed);
    expect(reduceSession(changed, { type: "reset" })).toEqual(INITIAL_SESSION);
  });
});

describe("reset and error are valid from any state", () => {
  const states: E2EESessionState[] = [
    INITIAL_SESSION,
    { status: "negotiating", scheme: "obby", initiator: true },
    { status: "pending-accept", scheme: "obby", peerFingerprint: "FP" },
    {
      status: "established",
      scheme: "obby",
      verified: true,
      peerFingerprint: "FP",
    },
  ];
  for (const s of states) {
    test(`reset from ${s.status}`, () => {
      expect(reduceSession(s, { type: "reset" })).toEqual(INITIAL_SESSION);
    });
    test(`error from ${s.status}`, () => {
      expect(reduceSession(s, { type: "error", reason: "boom" })).toEqual({
        status: "error",
        reason: "boom",
      });
    });
  }
});

describe("invalid events are ignored", () => {
  test("accept-local in none is a no-op", () => {
    expect(reduceSession(INITIAL_SESSION, { type: "accept-local" })).toBe(
      INITIAL_SESSION,
    );
  });

  test("accepted-remote while pending-accept is ignored", () => {
    const pending: E2EESessionState = {
      status: "pending-accept",
      scheme: "obby",
      peerFingerprint: "FP",
    };
    expect(
      reduceSession(pending, { type: "accepted-remote", peerFingerprint: "X" }),
    ).toBe(pending);
  });

  test("an initiator's premature established is a no-op until the peer key is known", () => {
    const negotiating = run([{ type: "start", scheme: "obby" }]);
    expect(reduceSession(negotiating, { type: "established" })).toBe(
      negotiating,
    );
  });
});
