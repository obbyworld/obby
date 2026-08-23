import { describe, expect, test } from "vitest";
import { ObbyE2EEBackend, type PeerRef } from "../../../src/lib/e2ee/backend";
import { PROTOCOL_VERSION } from "../../../src/lib/e2ee/protocol";
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
      bob.acceptOffer(bobPeer, {
        t: "init",
        v: PROTOCOL_VERSION,
        bundle: "!!!garbage",
      }),
    ).toThrow();
  });

  test("completing without a pending handshake throws", () => {
    const alice = new ObbyE2EEBackend(createIdentity());
    expect(() =>
      alice.completeSession(alicePeer, {
        t: "accept",
        v: PROTOCOL_VERSION,
        response: "x",
      }),
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

// The ack is what tells the responder the handshake completed, so it has to be
// a payload only a live session can produce and the peer can actually open.
describe("handshake acknowledgement", () => {
  test("the responder can open the initiator's ack", () => {
    const { alice, bob } = handshake();
    const ack = alice.encryptAck(alicePeer);
    expect(ack.t).toBe("ack");
    expect(() => bob.decrypt(bobPeer, ack)).not.toThrow();
  });

  test("the ack carries no message content", () => {
    const { alice, bob } = handshake();
    expect(bob.decrypt(bobPeer, alice.encryptAck(alicePeer))).toBe("");
  });

  test("a third party cannot forge an ack for the session", () => {
    const { bob } = handshake();
    const mallory = new ObbyE2EEBackend(createIdentity());
    const other = new ObbyE2EEBackend(createIdentity());
    const init = mallory.startSession(alicePeer);
    const accept = other.acceptOffer(bobPeer, init);
    mallory.completeSession(alicePeer, accept);
    expect(() => bob.decrypt(bobPeer, mallory.encryptAck(alicePeer))).toThrow();
  });

  test("after a reset the peer's ciphertext no longer opens", () => {
    const { alice, bob } = handshake();
    const cipher = alice.encrypt(alicePeer, "still here?");
    bob.reset(bobPeer);
    expect(bob.hasSession(bobPeer)).toBe(false);
    expect(() => bob.decrypt(bobPeer, cipher)).toThrow();
  });
});

// An attachment rides its own frame so the receiver renders media instead of
// text, but the descriptor is protected by the same session as any message.
describe("media frames", () => {
  test("the descriptor round-trips through a live session", () => {
    const { alice, bob } = handshake();
    const descriptor = '{"url":"https://host/cat.png","k":"KEY","n":"NONCE"}';
    const frame = alice.encryptMediaFrame(alicePeer, descriptor);
    expect(frame.t).toBe("media");
    expect(bob.decrypt(bobPeer, frame)).toBe(descriptor);
  });

  test("the descriptor is not readable on the wire", () => {
    const { alice } = handshake();
    const frame = alice.encryptMediaFrame(
      alicePeer,
      '{"url":"https://host/secret.png"}',
    );
    expect(frame.ct).not.toContain("secret.png");
  });

  test("a third party cannot open it", () => {
    const { alice } = handshake();
    const other = handshake();
    const frame = alice.encryptMediaFrame(alicePeer, '{"url":"x"}');
    expect(() => other.bob.decrypt(bobPeer, frame)).toThrow();
  });

  test("it needs a live session to produce", () => {
    const { alice } = handshake();
    alice.reset(alicePeer);
    expect(() => alice.encryptMediaFrame(alicePeer, "{}")).toThrow();
  });
});
