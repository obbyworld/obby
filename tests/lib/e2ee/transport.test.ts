import { describe, expect, test } from "vitest";
import {
  decodeE2EEPayload,
  type E2EEFragment,
  type E2EEPayload,
} from "../../../src/lib/e2ee/protocol";
import {
  FRAGMENT_TTL_MS,
  FragmentReassembler,
  frameValues,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAGMENTS_PER_STREAM,
} from "../../../src/lib/e2ee/transport";

const BIG = 4000;
const SLICE = 2800;

describe("frameValues — single value", () => {
  test("a payload within the cap frames as one base64 value", () => {
    const payload: E2EEPayload = { t: "msg", v: 2, ct: "Q0lQ" };
    const [value, ...rest] = frameValues(payload, "id1", BIG, SLICE);
    expect(rest).toHaveLength(0);
    expect(decodeE2EEPayload(value)).toEqual(payload);
  });

  test("every kind round-trips", () => {
    const kinds: E2EEPayload[] = [
      { t: "init", v: 2, bundle: "b" },
      { t: "accept", v: 2, response: "r" },
      { t: "reject", v: 2 },
      { t: "msg", v: 2, ct: "x" },
    ];
    for (const payload of kinds) {
      const [value] = frameValues(payload, "id", BIG, SLICE);
      expect(decodeE2EEPayload(value)).toEqual(payload);
    }
  });
});

describe("frameValues — fragmentation round-trip", () => {
  test("a payload over the cap splits into frag values that rebuild the original", () => {
    const payload: E2EEPayload = { t: "msg", v: 2, ct: "Z".repeat(8000) };
    const values = frameValues(payload, "msg42", 400, 220);
    expect(values.length).toBeGreaterThan(1);

    const frags: E2EEFragment[] = [];
    for (const value of values) {
      const decoded = decodeE2EEPayload(value);
      expect(decoded?.t).toBe("frag");
      frags.push(decoded as E2EEFragment);
    }

    const reassembler = new FragmentReassembler();
    let rebuilt: string | null = null;
    for (const f of frags) rebuilt = reassembler.add(f, 0) ?? rebuilt;
    expect(rebuilt).not.toBeNull();
    expect(decodeE2EEPayload(rebuilt as string)).toEqual(payload);
  });
});

describe("FragmentReassembler", () => {
  const frag = (
    id: string,
    i: number,
    n: number,
    ct: string,
  ): E2EEFragment => ({
    t: "frag",
    v: 2,
    id,
    i,
    n,
    ct,
  });

  test("completes only on the final fragment, regardless of order", () => {
    const r = new FragmentReassembler();
    expect(r.add(frag("a", 2, 3, "C"), 0)).toBeNull();
    expect(r.add(frag("a", 0, 3, "A"), 0)).toBeNull();
    expect(r.add(frag("a", 1, 3, "B"), 0)).toBe("ABC");
  });

  test("keeps concurrent streams separate by id", () => {
    const r = new FragmentReassembler();
    expect(r.add(frag("x", 0, 2, "x0"), 0)).toBeNull();
    expect(r.add(frag("y", 0, 2, "y0"), 0)).toBeNull();
    expect(r.add(frag("x", 1, 2, "x1"), 0)).toBe("x0x1");
    expect(r.add(frag("y", 1, 2, "y1"), 0)).toBe("y0y1");
  });

  test("drops a stale partial stream so it cannot complete later", () => {
    const r = new FragmentReassembler();
    expect(r.add(frag("z", 0, 2, "z0"), 0)).toBeNull();
    // The late second fragment arrives after the TTL; the buffer was swept, so
    // it starts a fresh (incomplete) buffer rather than completing the old one.
    expect(r.add(frag("z", 1, 2, "z1"), FRAGMENT_TTL_MS + 1)).toBeNull();
  });

  test("rejects a stream claiming more fragments than the cap", () => {
    const r = new FragmentReassembler();
    expect(
      r.add(frag("big", 0, MAX_FRAGMENTS_PER_STREAM + 1, "x"), 0),
    ).toBeNull();
  });

  test("rejects new streams once the concurrent-stream cap is reached", () => {
    const r = new FragmentReassembler();
    for (let i = 0; i < MAX_CONCURRENT_STREAMS; i++) {
      r.add(frag(`s${i}`, 0, 2, "a"), 0);
    }
    expect(r.add(frag("overflow", 0, 2, "a"), 0)).toBeNull();
  });
});
