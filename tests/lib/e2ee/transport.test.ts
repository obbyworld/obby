import { describe, expect, test } from "vitest";
import {
  bodyToRaw,
  decodeE2EEPayload,
  type E2EEFragment,
  type E2EEPayload,
} from "../../../src/lib/e2ee/protocol";
import {
  FRAGMENT_TTL_MS,
  FragmentReassembler,
  framePayload,
  frameTagPayload,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAGMENTS_PER_STREAM,
} from "../../../src/lib/e2ee/transport";

// A frame is the PRIVMSG body `?obe2ee:<base64>`; pull the value back out the
// same way the inbound path does, so tests exercise the real wire format.
function frameValue(body: string): string {
  const raw = bodyToRaw(body);
  if (raw === null) throw new Error(`not an Obby frame: ${body}`);
  return raw;
}

describe("framePayload — single frame", () => {
  test("frames a small payload as one Obby body", () => {
    const payload: E2EEPayload = { t: "msg", v: 2, ct: "Q0lQ" };
    const [body, ...rest] = framePayload(payload, "id1");
    expect(rest).toHaveLength(0);
    expect(decodeE2EEPayload(frameValue(body))).toEqual(payload);
  });

  test("every kind frames behind the Obby marker", () => {
    const kinds: E2EEPayload[] = [
      { t: "init", v: 2, bundle: "b" },
      { t: "accept", v: 2, response: "r" },
      { t: "reject", v: 2 },
      { t: "msg", v: 2, ct: "x" },
    ];
    for (const payload of kinds) {
      const [body] = framePayload(payload, "id");
      expect(decodeE2EEPayload(frameValue(body))).toEqual(payload);
    }
  });
});

describe("frameTagPayload — control frames", () => {
  test("frames a control payload as one raw tag value", () => {
    const payload: E2EEPayload = { t: "init", v: 2, bundle: "b" };
    const [value, ...rest] = frameTagPayload(payload, "id1");
    expect(rest).toHaveLength(0);
    expect(value.startsWith("?obe2ee:")).toBe(false);
    expect(decodeE2EEPayload(value)).toEqual(payload);
  });

  test("oversized control payload splits into frag tag values", () => {
    const payload: E2EEPayload = {
      t: "accept",
      v: 2,
      response: "R".repeat(6000),
    };
    const values = frameTagPayload(payload, "acc1");
    expect(values.length).toBeGreaterThan(1);
    const frags = values.map((v) => decodeE2EEPayload(v) as E2EEFragment);
    for (const f of frags) expect(f.t).toBe("frag");
    const r = new FragmentReassembler();
    let rebuilt: string | null = null;
    for (const f of frags) rebuilt = r.add(f, 0) ?? rebuilt;
    expect(decodeE2EEPayload(rebuilt as string)).toEqual(payload);
  });
});

describe("framePayload — fragmentation round-trip", () => {
  test("oversized payload splits into frag frames that rebuild the original", () => {
    const payload: E2EEPayload = { t: "msg", v: 2, ct: "Z".repeat(8000) };
    const bodies = framePayload(payload, "msg42");
    expect(bodies.length).toBeGreaterThan(1);

    const frags: E2EEFragment[] = [];
    for (const body of bodies) {
      const decoded = decodeE2EEPayload(frameValue(body));
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
