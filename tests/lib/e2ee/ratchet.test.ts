import { beforeAll, describe, expect, test } from "vitest";
import {
  acceptBundle,
  completeHandshake,
  createIdentity,
  createPreKeyBundle,
  fingerprintOf,
  type Identity,
  type PendingHandshake,
  type RatchetState,
  ratchetDecrypt,
  ratchetEncrypt,
} from "../../../src/lib/e2ee/ratchet";

// Establishes a full session and returns both live ratchet states plus the
// identities, so each test starts from an agreed session like the real client.
function establish(firstFromResponder = "hello"): {
  alice: Identity;
  bob: Identity;
  pending: PendingHandshake;
  aliceState: RatchetState;
  bobState: RatchetState;
  firstPlaintext: string;
} {
  const alice = createIdentity();
  const bob = createIdentity();
  const pending = createPreKeyBundle(alice);
  const { response, state: bobState } = acceptBundle(
    bob,
    pending.bundle,
    firstFromResponder,
  );
  const { state: aliceState, firstPlaintext } = completeHandshake(
    alice,
    pending,
    response,
  );
  return { alice, bob, pending, aliceState, bobState, firstPlaintext };
}

describe("X3DH handshake", () => {
  test("the bootstrap message decrypts on the initiator side", () => {
    const { firstPlaintext } = establish("opening message");
    expect(firstPlaintext).toBe("opening message");
  });

  test("both sides derive a working session (bidirectional exchange)", () => {
    const { aliceState, bobState } = establish();
    const a1 = ratchetEncrypt(aliceState, "hi bob");
    expect(ratchetDecrypt(bobState, a1)).toBe("hi bob");
    const b1 = ratchetEncrypt(bobState, "hi alice");
    expect(ratchetDecrypt(aliceState, b1)).toBe("hi alice");
  });

  test("a forged signed-pre-key signature is rejected", () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const pending = createPreKeyBundle(alice);
    const tampered = {
      ...pending.bundle,
      spk: createPreKeyBundle(alice).bundle.spk,
    };
    expect(() => acceptBundle(bob, tampered, "x")).toThrow();
  });
});

describe("messaging", () => {
  test("a long ping-pong stays in sync across DH ratchet steps", () => {
    const { aliceState, bobState } = establish();
    for (let i = 0; i < 6; i++) {
      const a = ratchetEncrypt(aliceState, `a${i}`);
      expect(ratchetDecrypt(bobState, a)).toBe(`a${i}`);
      const b = ratchetEncrypt(bobState, `b${i}`);
      expect(ratchetDecrypt(aliceState, b)).toBe(`b${i}`);
    }
  });

  test("consecutive messages in one chain use distinct ciphertexts", () => {
    const { aliceState, bobState } = establish();
    const m1 = ratchetEncrypt(aliceState, "same text");
    const m2 = ratchetEncrypt(aliceState, "same text");
    expect(m1.ct).not.toBe(m2.ct);
    expect(ratchetDecrypt(bobState, m1)).toBe("same text");
    expect(ratchetDecrypt(bobState, m2)).toBe("same text");
  });

  test("out-of-order delivery is handled via skipped message keys", () => {
    const { aliceState, bobState } = establish();
    const m0 = ratchetEncrypt(aliceState, "zero");
    const m1 = ratchetEncrypt(aliceState, "one");
    const m2 = ratchetEncrypt(aliceState, "two");
    // Bob receives 0, then 2 (skipping 1), then the delayed 1.
    expect(ratchetDecrypt(bobState, m0)).toBe("zero");
    expect(ratchetDecrypt(bobState, m2)).toBe("two");
    expect(ratchetDecrypt(bobState, m1)).toBe("one");
  });

  test("unicode survives the round-trip", () => {
    const { aliceState, bobState } = establish();
    const text = "héllo 🌍 çava — Zürich";
    expect(ratchetDecrypt(bobState, ratchetEncrypt(aliceState, text))).toBe(
      text,
    );
  });
});

describe("tamper detection", () => {
  test("a flipped ciphertext byte fails authentication", () => {
    const { aliceState, bobState } = establish();
    const m = ratchetEncrypt(aliceState, "secret");
    const bytes = Buffer.from(m.ct, "base64");
    bytes[0] ^= 0xff;
    expect(() =>
      ratchetDecrypt(bobState, { ...m, ct: bytes.toString("base64") }),
    ).toThrow();
  });

  test("a rewritten header counter fails authentication", () => {
    const { aliceState, bobState } = establish();
    const m = ratchetEncrypt(aliceState, "secret");
    expect(() => ratchetDecrypt(bobState, { ...m, n: m.n + 5 })).toThrow();
  });

  test("an implausible message-number jump is refused, not buffered", () => {
    const { aliceState, bobState } = establish();
    const m0 = ratchetEncrypt(aliceState, "zero");
    ratchetDecrypt(bobState, m0);
    expect(() => ratchetDecrypt(bobState, { ...m0, n: 5000 })).toThrow();
  });
});

describe("session resilience to forged packets", () => {
  // A relay can inject a packet with a valid header but garbage ciphertext;
  // decryption must fail without corrupting the receiver's ratchet state.
  const forge = (m: ReturnType<typeof ratchetEncrypt>) => {
    const bytes = Buffer.from(m.ct, "base64");
    bytes[0] ^= 0xff;
    return { ...m, ct: bytes.toString("base64") };
  };

  test("a forged in-chain packet does not desync the real follow-up", () => {
    const { aliceState, bobState } = establish();
    expect(ratchetDecrypt(bobState, ratchetEncrypt(aliceState, "m0"))).toBe(
      "m0",
    );
    const m1 = ratchetEncrypt(aliceState, "m1");
    expect(() => ratchetDecrypt(bobState, forge(m1))).toThrow();
    expect(ratchetDecrypt(bobState, m1)).toBe("m1");
  });

  test("a forged skipped-key packet does not burn the delayed real message", () => {
    const { aliceState, bobState } = establish();
    const m0 = ratchetEncrypt(aliceState, "m0");
    const m1 = ratchetEncrypt(aliceState, "m1");
    const m2 = ratchetEncrypt(aliceState, "m2");
    expect(ratchetDecrypt(bobState, m0)).toBe("m0");
    expect(ratchetDecrypt(bobState, m2)).toBe("m2");
    expect(() => ratchetDecrypt(bobState, forge(m1))).toThrow();
    expect(ratchetDecrypt(bobState, m1)).toBe("m1");
  });

  test("out-of-order delivery across a DH-ratchet boundary still resolves", () => {
    const { aliceState, bobState } = establish();
    expect(ratchetDecrypt(bobState, ratchetEncrypt(aliceState, "a0"))).toBe(
      "a0",
    );
    expect(ratchetDecrypt(aliceState, ratchetEncrypt(bobState, "b0"))).toBe(
      "b0",
    );
    const a1 = ratchetEncrypt(aliceState, "a1");
    const a2 = ratchetEncrypt(aliceState, "a2");
    expect(ratchetDecrypt(bobState, a2)).toBe("a2");
    expect(ratchetDecrypt(bobState, a1)).toBe("a1");
  });
});

describe("identity fingerprint", () => {
  let id: Identity;
  beforeAll(() => {
    id = createIdentity();
  });

  test("is stable for a given signing key", () => {
    expect(fingerprintOf(id.sikPub)).toBe(fingerprintOf(id.sikPub));
  });

  test("differs between identities", () => {
    expect(fingerprintOf(id.sikPub)).not.toBe(
      fingerprintOf(createIdentity().sikPub),
    );
  });
});
