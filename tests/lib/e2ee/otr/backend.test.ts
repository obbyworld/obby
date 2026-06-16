import { describe, expect, test, vi } from "vitest";
import {
  OtrBackend,
  type OtrCallbacks,
  type OtrPeerRef,
} from "../../../../src/lib/e2ee/otr/backend";
import { DSA, OTR } from "../../../../src/lib/otr/vendor/otr.bundle";
import { ALICE_KEY, BOB_KEY } from "../../../fixtures/otrKeys";

// Large fragment budget + no inter-fragment delay keeps the AKE single-framed and
// fast; the IRC defaults (400 / 200ms) are exercised in real use, not here.
const FAST = { fragmentSize: 65536, sendInterval: 0 };

const noop: OtrCallbacks = {
  onOutbound: () => {},
  onPlaintext: () => {},
  onEstablished: () => {},
  onEnded: () => {},
  onError: () => {},
};

describe("OtrBackend — AKE + message round-trip", () => {
  test("two parties handshake and exchange messages both directions", async () => {
    const peerBob: OtrPeerRef = { serverId: "s", nick: "bob" };
    const peerAlice: OtrPeerRef = { serverId: "s", nick: "alice" };
    let aliceGot: string | null = null;
    let bobGot: string | null = null;
    let alicePeerFp: string | null = null;
    let bobPeerFp: string | null = null;
    let alice!: OtrBackend;
    let bob!: OtrBackend;

    alice = new OtrBackend(
      OTR,
      DSA.parsePrivate(ALICE_KEY.packed),
      {
        onOutbound: (_p, frame) => bob.receive(peerAlice, frame),
        onPlaintext: (_p, msg) => {
          aliceGot = msg;
        },
        onEstablished: (_p, fp) => {
          alicePeerFp = fp;
        },
        onEnded: () => {},
        onError: () => {},
      },
      FAST,
    );

    bob = new OtrBackend(
      OTR,
      DSA.parsePrivate(BOB_KEY.packed),
      {
        onOutbound: (_p, frame) => alice.receive(peerBob, frame),
        onPlaintext: (_p, msg) => {
          bobGot = msg;
        },
        onEstablished: (_p, fp) => {
          bobPeerFp = fp;
        },
        onEnded: () => {},
        onError: () => {},
      },
      FAST,
    );

    alice.start(peerBob);
    await vi.waitFor(
      () => {
        expect(alicePeerFp).not.toBeNull();
        expect(bobPeerFp).not.toBeNull();
      },
      { timeout: 8000, interval: 25 },
    );

    // Each side learns the OTHER party's long-term fingerprint.
    expect(alicePeerFp).toBe(BOB_KEY.fingerprint);
    expect(bobPeerFp).toBe(ALICE_KEY.fingerprint);
    expect(alice.peerFingerprint(peerBob)).toBe(BOB_KEY.fingerprint);
    expect(bob.peerFingerprint(peerAlice)).toBe(ALICE_KEY.fingerprint);

    alice.encrypt(peerBob, "hello bob");
    await vi.waitFor(() => expect(bobGot).toBe("hello bob"), {
      timeout: 8000,
      interval: 25,
    });

    bob.encrypt(peerAlice, "hi alice");
    await vi.waitFor(() => expect(aliceGot).toBe("hi alice"), {
      timeout: 8000,
      interval: 25,
    });
  });
});

describe("OtrBackend — identity & sessions", () => {
  test("selfFingerprint reflects the identity key", () => {
    const alice = new OtrBackend(OTR, DSA.parsePrivate(ALICE_KEY.packed), noop);
    expect(alice.selfFingerprint()).toBe(ALICE_KEY.fingerprint);
  });

  test("hasSession is false until a session is started", () => {
    const alice = new OtrBackend(OTR, DSA.parsePrivate(ALICE_KEY.packed), noop);
    const peer: OtrPeerRef = { serverId: "s", nick: "carol" };
    expect(alice.hasSession(peer)).toBe(false);
    expect(alice.peerFingerprint(peer)).toBeNull();
    alice.start(peer);
    expect(alice.hasSession(peer)).toBe(true);
  });
});
