import { beforeEach, describe, expect, test } from "vitest";
import { createPeerTrustStore } from "../../../src/lib/e2ee/peerTrust";

// The global setup mocks localStorage as no-op spies; swap in a real in-memory
// store so the TOFU persistence round-trip is actually exercised.
beforeEach(() => {
  const data = new Map<string, string>();
  window.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

describe("createPeerTrustStore (TOFU)", () => {
  test("first sight pins the fingerprint as new and unverified", () => {
    const trust = createPeerTrustStore("test.peers");
    expect(trust.pin("srv", "bob", "AAAA")).toBe("new");
    expect(trust.get("srv", "bob")).toEqual({
      fingerprint: "AAAA",
      verified: false,
    });
  });

  test("re-seeing the same fingerprint reports same", () => {
    const trust = createPeerTrustStore("test.peers");
    trust.pin("srv", "bob", "AAAA");
    expect(trust.pin("srv", "bob", "AAAA")).toBe("same");
  });

  test("a different fingerprint is reported changed without overwriting the pin", () => {
    const trust = createPeerTrustStore("test.peers");
    trust.pin("srv", "bob", "AAAA");
    expect(trust.pin("srv", "bob", "BBBB")).toBe("changed");
    expect(trust.get("srv", "bob")?.fingerprint).toBe("AAAA");
  });

  test("verify flips the stored flag", () => {
    const trust = createPeerTrustStore("test.peers");
    trust.pin("srv", "bob", "AAAA");
    trust.setVerified("srv", "bob");
    expect(trust.get("srv", "bob")?.verified).toBe(true);
  });

  test("repin replaces the key and clears the verified flag", () => {
    const trust = createPeerTrustStore("test.peers");
    trust.pin("srv", "bob", "AAAA");
    trust.setVerified("srv", "bob");
    trust.repin("srv", "bob", "CCCC");
    expect(trust.get("srv", "bob")).toEqual({
      fingerprint: "CCCC",
      verified: false,
    });
  });

  test("pins are keyed by nick case-insensitively", () => {
    const trust = createPeerTrustStore("test.peers");
    trust.pin("srv", "Bob", "AAAA");
    expect(trust.get("srv", "bob")?.fingerprint).toBe("AAAA");
  });

  test("unknown peers return null", () => {
    const trust = createPeerTrustStore("test.peers");
    expect(trust.get("srv", "nobody")).toBeNull();
  });

  test("separate storage keys keep separate pins", () => {
    const otr = createPeerTrustStore("otr.peers");
    const obby = createPeerTrustStore("obby.peers");
    otr.pin("srv", "bob", "AAAA");
    expect(obby.get("srv", "bob")).toBeNull();
  });
});
