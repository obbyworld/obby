import { describe, expect, test } from "vitest";
import { ObbyE2EEBackend, type PeerRef } from "../../../src/lib/e2ee/backend";
import { createIdentity } from "../../../src/lib/e2ee/ratchet";

const alicePeer: PeerRef = { serverId: "s1", nick: "bob" };
const bobPeer: PeerRef = { serverId: "s1", nick: "alice" };

// Drives a full handshake between two independent backends through the opaque
// wire payloads, returning both so message tests start from a live session.
function handshake(): { alice: ObbyE2EEBackend; bob: ObbyE2EEBackend } {
  const alice = new ObbyE2EEBackend(createIdentity());
  const bob = new ObbyE2EEBackend(createIdentity());
  const init = alice.startSession(alicePeer);
  const accept = bob.acceptOffer(bobPeer, init);
  alice.completeSession(alicePeer, accept);
  return { alice, bob };
}

describe("ObbyE2EEBackend handshake", () => {
  test("both sides establish a session", () => {
    const { alice, bob } = handshake();
    expect(alice.hasSession(alicePeer)).toBe(true);
    expect(bob.hasSession(bobPeer)).toBe(true);
  });

  test("each side learns the other's real fingerprint", () => {
    const alice = new ObbyE2EEBackend(createIdentity());
    const bob = new ObbyE2EEBackend(createIdentity());
    const init = alice.startSession(alicePeer);
    const accept = bob.acceptOffer(bobPeer, init);
    alice.completeSession(alicePeer, accept);
    expect(bob.peerFingerprint(bobPeer)).toBe(alice.selfFingerprint());
    expect(alice.peerFingerprint(alicePeer)).toBe(bob.selfFingerprint());
  });

  test("offeredFingerprint matches the sender's self fingerprint before accepting", () => {
    const alice = new ObbyE2EEBackend(createIdentity());
    const bob = new ObbyE2EEBackend(createIdentity());
    const init = alice.startSession(alicePeer);
    expect(bob.offeredFingerprint(init)).toBe(alice.selfFingerprint());
  });
});

describe("ObbyE2EEBackend messaging", () => {
  test("messages round-trip in both directions", () => {
    const { alice, bob } = handshake();
    const c1 = alice.encrypt(alicePeer, "hi bob");
    expect(bob.decrypt(bobPeer, c1)).toBe("hi bob");
    const c2 = bob.encrypt(bobPeer, "hi alice");
    expect(alice.decrypt(alicePeer, c2)).toBe("hi alice");
  });

  test("the ciphertext does not contain the plaintext", () => {
    const { alice } = handshake();
    expect(alice.encrypt(alicePeer, "topsecret").ct).not.toContain("topsecret");
  });

  test("encrypt/decrypt without a session throws", () => {
    const fresh = new ObbyE2EEBackend(createIdentity());
    expect(() => fresh.encrypt(alicePeer, "x")).toThrow();
  });
});

describe("ObbyE2EEBackend robustness", () => {
  test("a malformed offer is rejected, not silently accepted", () => {
    const bob = new ObbyE2EEBackend(createIdentity());
    expect(() =>
      bob.acceptOffer(bobPeer, { t: "init", v: 2, bundle: "!!!garbage" }),
    ).toThrow();
  });

  test("completing without a pending handshake throws", () => {
    const alice = new ObbyE2EEBackend(createIdentity());
    expect(() =>
      alice.completeSession(alicePeer, { t: "accept", v: 2, response: "x" }),
    ).toThrow();
  });

  test("reset drops the session", () => {
    const { alice } = handshake();
    alice.reset(alicePeer);
    expect(alice.hasSession(alicePeer)).toBe(false);
    expect(alice.peerFingerprint(alicePeer)).toBeNull();
  });

  test("the pending handshake is consumed exactly once", () => {
    const alice = new ObbyE2EEBackend(createIdentity());
    const bob = new ObbyE2EEBackend(createIdentity());
    const init = alice.startSession(alicePeer);
    expect(alice.hasPending(alicePeer)).toBe(true);
    const accept = bob.acceptOffer(bobPeer, init);
    alice.completeSession(alicePeer, accept);
    // The handler gates a second accept on hasPending so a duplicate or replayed
    // accept can't re-run completeSession and clobber the live session.
    expect(alice.hasPending(alicePeer)).toBe(false);
  });
});
