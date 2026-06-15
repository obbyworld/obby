import { describe, expect, test } from "vitest";
import {
  decodeE2EEPayload,
  E2EE_TAG,
  type E2EEFragment,
  type E2EEPayload,
} from "../../../src/lib/e2ee/protocol";
import {
  FRAGMENT_TTL_MS,
  FragmentReassembler,
  framePayload,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAGMENTS_PER_STREAM,
} from "../../../src/lib/e2ee/transport";

// A TAGMSG line is `@<tag>=<value> TAGMSG <target>`; pull the value back out the
// same way the IRC layer's tag parser would, so tests exercise the real wire.
function parseLine(line: string): {
  tag: string;
  value: string;
  target: string;
} {
  const m = line.match(/^@([^=]+)=(.*) TAGMSG (.+)$/);
  if (!m) throw new Error(`unparseable line: ${line}`);
  return { tag: m[1], value: m[2], target: m[3] };
}

describe("framePayload — single line", () => {
  test("frames a small payload as one TAGMSG under the e2ee tag", () => {
    const payload: E2EEPayload = { t: "msg", v: 1, ct: "Q0lQ" };
    const [line, ...rest] = framePayload(payload, "bob", "id1");
    expect(rest).toHaveLength(0);
    const parsed = parseLine(line);
    expect(parsed.tag).toBe(E2EE_TAG);
    expect(parsed.target).toBe("bob");
    expect(decodeE2EEPayload(parsed.value)).toEqual(payload);
  });

  test("every kind frames under the single e2ee tag", () => {
    const kinds: E2EEPayload[] = [
      { t: "init", v: 1, bundle: "b" },
      { t: "accept", v: 1, response: "r" },
      { t: "reject", v: 1 },
      { t: "msg", v: 1, ct: "x" },
    ];
    for (const payload of kinds) {
      const { tag } = parseLine(framePayload(payload, "bob", "id")[0]);
      expect(tag).toBe(E2EE_TAG);
    }
  });
});

describe("framePayload — fragmentation round-trip", () => {
  test("oversized payload splits into frag lines that rebuild the original", () => {
    const payload: E2EEPayload = { t: "msg", v: 1, ct: "Z".repeat(8000) };
    const lines = framePayload(payload, "bob", "msg42");
    expect(lines.length).toBeGreaterThan(1);

    const frags: E2EEFragment[] = [];
    for (const line of lines) {
      const { tag, value } = parseLine(line);
      expect(tag).toBe(E2EE_TAG);
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
    v: 1,
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
