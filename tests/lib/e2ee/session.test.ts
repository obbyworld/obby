import { describe, expect, test } from "vitest";
import {
  type E2EEEvent,
  type E2EESessionState,
  expectsProtection,
  INITIAL_SESSION,
  isWithholding,
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
  });

  test("remote reject ends in rejected", () => {
    const state = run([
      { type: "start", scheme: "otr" },
      { type: "rejected-remote" },
    ]);
    expect(state).toEqual({ status: "rejected", scheme: "otr" });
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
    // Only an explicit reset or the user accepting the new key clears it.
    expect(reduceSession(changed, { type: "verify" })).toBe(changed);
    expect(reduceSession(changed, { type: "established" })).toBe(changed);
    expect(reduceSession(changed, { type: "reset" })).toEqual(INITIAL_SESSION);
  });

  test("accepting the changed key resumes under the new fingerprint, unverified", () => {
    const changed = reduceSession(established, {
      type: "key-change",
      oldFingerprint: "FP",
      newFingerprint: "FP2",
    });
    expect(reduceSession(changed, { type: "trust-key" })).toEqual({
      status: "established",
      scheme: "obby",
      verified: false,
      peerFingerprint: "FP2",
    });
  });

  test("trust-key does nothing outside a key change", () => {
    expect(reduceSession(established, { type: "trust-key" })).toBe(established);
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
      expect(
        reduceSession(s, { type: "error", reason: "handshake-failed" }),
      ).toEqual({
        status: "error",
        reason: "handshake-failed",
        wasEstablished: s.status === "established",
      });
    });
  }
});

// A session that broke after it was live keeps the send path from falling back
// to plaintext, so the distinction has to survive the reducer.
describe("error carries whether the session was live", () => {
  test("from established, wasEstablished is true", () => {
    const state = reduceSession(
      {
        status: "established",
        scheme: "otr",
        verified: false,
        peerFingerprint: "FP",
      },
      { type: "error", reason: "peer-ended" },
    );
    expect(state).toMatchObject({ status: "error", wasEstablished: true });
  });

  test("from key-changed, wasEstablished stays true", () => {
    const state = reduceSession(
      {
        status: "key-changed",
        scheme: "obby",
        oldFingerprint: "FP",
        newFingerprint: "FP2",
      },
      { type: "error", reason: "peer-ended" },
    );
    expect(state).toMatchObject({ status: "error", wasEstablished: true });
  });

  test("from a failed handshake, wasEstablished is false", () => {
    const state = reduceSession(
      { status: "negotiating", scheme: "otr", initiator: true },
      { type: "error", reason: "handshake-failed" },
    );
    expect(state).toMatchObject({ status: "error", wasEstablished: false });
  });
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

// A broken session still shows the user a conversation they opened under a
// lock, so plaintext arriving in it is worth flagging. Narrowing this to
// "established" marks the first such message and none of the ones after it.
describe("plaintext arriving under a lock", () => {
  test("a live session flags it", () => {
    expect(
      expectsProtection({
        status: "established",
        scheme: "obby",
        verified: false,
        peerFingerprint: "FP",
      }),
    ).toBe(true);
  });

  test("a session that broke after it was live keeps flagging it", () => {
    expect(
      expectsProtection({
        status: "error",
        reason: "peer-ended",
        wasEstablished: true,
      }),
    ).toBe(true);
  });

  test("a changed key keeps flagging it", () => {
    expect(
      expectsProtection({
        status: "key-changed",
        scheme: "obby",
        oldFingerprint: "A",
        newFingerprint: "B",
      }),
    ).toBe(true);
  });

  test("a handshake that never completed does not", () => {
    expect(expectsProtection({ status: "error", reason: "no-response" })).toBe(
      false,
    );
    expect(expectsProtection(undefined)).toBe(false);
    expect(expectsProtection({ status: "none" })).toBe(false);
  });
});

describe("states that refuse to carry a message", () => {
  test("a handshake in flight withholds", () => {
    expect(
      isWithholding({ status: "negotiating", scheme: "obby", initiator: true }),
    ).toBe(true);
  });

  test("a session that broke after it was live withholds", () => {
    expect(
      isWithholding({
        status: "error",
        reason: "encryption-lost",
        wasEstablished: true,
      }),
    ).toBe(true);
  });

  test("a live session and a dead handshake both send", () => {
    expect(
      isWithholding({
        status: "established",
        scheme: "obby",
        verified: false,
        peerFingerprint: "FP",
      }),
    ).toBe(false);
    expect(isWithholding({ status: "error", reason: "no-response" })).toBe(
      false,
    );
  });
});
