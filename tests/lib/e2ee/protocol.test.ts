import { describe, expect, test } from "vitest";
import {
  decodeE2EEPayload,
  type E2EEPayload,
  encodeE2EEPayload,
  fragmentValue,
  readPayloadVersion,
  reassembleFragments,
} from "../../../src/lib/e2ee/protocol";

// Tag values are base64 of compact JSON; wrap raw test inputs the same way a
// peer would on the wire so decode is exercised against attacker-shaped input.
const b64 = (o: unknown): string =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64");

describe("encode/decode round-trip", () => {
  const cases: E2EEPayload[] = [
    { t: "init", v: 2, bundle: "BUNDLE-b64", account: "alice" },
    { t: "accept", v: 2, response: "RESPONSE-b64", account: "bob" },
    { t: "reject", v: 2, reason: "declined" },
    { t: "msg", v: 2, ct: "Q0lQSEVS", pre: true },
    { t: "msg", v: 2, ct: "Q0lQSEVS" },
    { t: "frag", v: 2, id: "f1", i: 0, n: 2, ct: "AAAA" },
  ];
  for (const payload of cases) {
    test(`${payload.t}${"pre" in payload && payload.pre ? " (prekey)" : ""}`, () => {
      expect(decodeE2EEPayload(encodeE2EEPayload(payload))).toEqual(payload);
    });
  }
});

describe("decodeE2EEPayload rejects malformed input", () => {
  test("empty string", () => {
    expect(decodeE2EEPayload("")).toBeNull();
  });
  test("not base64 / not JSON", () => {
    expect(decodeE2EEPayload("!!!not base64!!!")).toBeNull();
  });
  test("non-object JSON", () => {
    expect(decodeE2EEPayload(b64(42))).toBeNull();
  });
  test("wrong protocol version", () => {
    expect(decodeE2EEPayload(b64({ t: "msg", v: 1, ct: "x" }))).toBeNull();
  });
  test("unknown type", () => {
    expect(decodeE2EEPayload(b64({ t: "bogus", v: 2 }))).toBeNull();
  });
  test("init missing bundle", () => {
    expect(decodeE2EEPayload(b64({ t: "init", v: 2 }))).toBeNull();
  });
  test("accept missing response", () => {
    expect(decodeE2EEPayload(b64({ t: "accept", v: 2 }))).toBeNull();
  });
  test("msg missing ciphertext", () => {
    expect(decodeE2EEPayload(b64({ t: "msg", v: 2 }))).toBeNull();
  });
  test("frag with index out of range", () => {
    expect(
      decodeE2EEPayload(b64({ t: "frag", v: 2, id: "x", i: 3, n: 2, ct: "a" })),
    ).toBeNull();
  });
  test("frag with non-integer total", () => {
    expect(
      decodeE2EEPayload(
        b64({ t: "frag", v: 2, id: "x", i: 0, n: 1.5, ct: "a" }),
      ),
    ).toBeNull();
  });
  test("init drops a non-string account rather than trusting it", () => {
    const got = decodeE2EEPayload(
      b64({ t: "init", v: 2, bundle: "x", account: 7 }),
    );
    expect(got).toEqual({ t: "init", v: 2, bundle: "x" });
  });
});

describe("fragmentation", () => {
  test("round-trips a value larger than the slice size", () => {
    const value = "A".repeat(50) + "B".repeat(50);
    const frags = fragmentValue("f1", value, 30);
    expect(frags.length).toBe(Math.ceil(value.length / 30));
    expect(frags.every((f) => f.id === "f1" && f.n === frags.length)).toBe(
      true,
    );
    expect(reassembleFragments(frags)).toBe(value);
  });

  test("reassembles regardless of arrival order", () => {
    const value = "0123456789abcdef";
    const frags = fragmentValue("f2", value, 4);
    const shuffled = [frags[2], frags[0], frags[3], frags[1]];
    expect(reassembleFragments(shuffled)).toBe(value);
  });

  test("returns null when a fragment is missing", () => {
    const frags = fragmentValue("f3", "0123456789", 3);
    expect(reassembleFragments(frags.slice(1))).toBeNull();
  });

  test("returns null for an empty set or mismatched totals", () => {
    expect(reassembleFragments([])).toBeNull();
    expect(
      reassembleFragments([
        { t: "frag", v: 2, id: "x", i: 0, n: 2, ct: "a" },
        { t: "frag", v: 2, id: "x", i: 1, n: 3, ct: "b" },
      ]),
    ).toBeNull();
  });

  test("rejects fragments spliced from two different ids", () => {
    expect(
      reassembleFragments([
        { t: "frag", v: 2, id: "A", i: 0, n: 2, ct: "AA" },
        { t: "frag", v: 2, id: "B", i: 1, n: 2, ct: "BB" },
      ]),
    ).toBeNull();
  });

  test("a duplicate index cannot stand in for a missing one", () => {
    expect(
      reassembleFragments([
        { t: "frag", v: 2, id: "x", i: 0, n: 2, ct: "a" },
        { t: "frag", v: 2, id: "x", i: 0, n: 2, ct: "a" },
      ]),
    ).toBeNull();
  });

  test("a single short value yields one fragment", () => {
    const frags = fragmentValue("f4", "short", 100);
    expect(frags.length).toBe(1);
    expect(reassembleFragments(frags)).toBe("short");
  });
});

describe("control frames", () => {
  test("close round-trips", () => {
    const encoded = encodeE2EEPayload({ t: "close", v: 2 });
    expect(decodeE2EEPayload(encoded)).toEqual({ t: "close", v: 2 });
  });

  test("ack round-trips and requires its ciphertext", () => {
    const encoded = encodeE2EEPayload({ t: "ack", v: 2, ct: "Q0lQ" });
    expect(decodeE2EEPayload(encoded)).toEqual({ t: "ack", v: 2, ct: "Q0lQ" });
    expect(
      decodeE2EEPayload(
        // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
        encodeE2EEPayload({ t: "ack", v: 2 } as any),
      ),
    ).toBeNull();
  });
});

// A frame from a version we don't speak decodes to null like garbage does, so
// the version has to be readable separately for the peer to be told why.
describe("readPayloadVersion", () => {
  test("reports the version of an otherwise undecodable frame", () => {
    // biome-ignore lint/suspicious/noExplicitAny: a future version by construction
    const future = encodeE2EEPayload({ t: "msg", v: 99, ct: "x" } as any);
    expect(decodeE2EEPayload(future)).toBeNull();
    expect(readPayloadVersion(future)).toBe(99);
  });

  test("returns null for non-payload input", () => {
    expect(readPayloadVersion("not base64 json")).toBeNull();
    expect(readPayloadVersion("")).toBeNull();
  });
});
