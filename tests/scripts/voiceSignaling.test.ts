import { describe, expect, it } from "vitest";
import {
  ChunkReassembler,
  chunkSignal,
  encodeTagPrefix,
  escapeIrcTagValue,
  RTC_TAG,
  unescapeIrcTagValue,
  WIRE_BUDGET,
  wireSize,
} from "../../scripts/lib/voiceSignaling.mjs";

describe("escapeIrcTagValue / unescapeIrcTagValue", () => {
  it("round-trips every escaped character", () => {
    const raw = 'a;b c\\d\re\nf"g';
    expect(unescapeIrcTagValue(escapeIrcTagValue(raw))).toBe(raw);
  });

  it("matches UnrealIRCd's escape table byte-for-byte", () => {
    expect(escapeIrcTagValue(";")).toBe("\\:");
    expect(escapeIrcTagValue(" ")).toBe("\\s");
    expect(escapeIrcTagValue("\\")).toBe("\\\\");
    expect(escapeIrcTagValue("\r")).toBe("\\r");
    expect(escapeIrcTagValue("\n")).toBe("\\n");
    expect(escapeIrcTagValue("plain")).toBe("plain");
  });

  it("round-trips a realistic SDP fragment", () => {
    const sdp =
      "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AB:CD;EF\r\n";
    expect(unescapeIrcTagValue(escapeIrcTagValue(sdp))).toBe(sdp);
  });

  it("drops the backslash for an unrecognized escape sequence", () => {
    expect(unescapeIrcTagValue("a\\zb")).toBe("azb");
  });
});

describe("chunkSignal + ChunkReassembler round-trip", () => {
  it("leaves a small envelope unchunked", () => {
    const env = { type: "join", channel: "^test" };
    const chunks = chunkSignal(env);
    expect(chunks).toEqual([env]);
  });

  it("leaves a non-offer/answer envelope unchunked even if huge", () => {
    const env = { type: "ice", cand: "x".repeat(20000) };
    const chunks = chunkSignal(env);
    expect(chunks).toEqual([env]);
  });

  it("splits an oversized offer into chunks that each fit the wire budget", () => {
    // Dense in CR/LF and spaces, the worst case for encodedTagCost.
    const sdp = "a=candidate:1 1 UDP 12345 127.0.0.1 5000 typ host\r\n".repeat(
      400,
    );
    const env = { type: "offer", sdp };
    const chunks = chunkSignal(env);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(wireSize(chunk)).toBeLessThanOrEqual(WIRE_BUDGET);
      expect(chunk.id).toBe(chunks[0].id);
      expect(chunk.total).toBe(chunks.length);
    }
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
  });

  it("reassembles a chunked offer back to the original envelope", () => {
    const sdp =
      "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n".repeat(500) +
      'a=weird;"quoted"\\ value';
    const env = {
      type: "answer",
      sdp,
      tracks: [{ track_id: "t1", member: "bob", kind: "video" }],
    };
    const chunks = chunkSignal(env);
    expect(chunks.length).toBeGreaterThan(1);

    const reassembler = new ChunkReassembler();
    let result = null;
    for (const chunk of chunks) {
      result = reassembler.push(chunk);
    }
    expect(result).not.toBeNull();
    expect(result.type).toBe("answer");
    expect(result.sdp).toBe(sdp);
    expect(result.tracks).toEqual(env.tracks);
  });

  it("reassembles chunks that arrive out of order", () => {
    const sdp = "x".repeat(30000);
    const env = { type: "offer", sdp };
    const chunks = chunkSignal(env);
    expect(chunks.length).toBeGreaterThan(2);

    const shuffled = [
      chunks[chunks.length - 1],
      ...chunks.slice(0, -1),
    ].reverse();
    const reassembler = new ChunkReassembler();
    let result = null;
    for (const chunk of shuffled) {
      const r = reassembler.push(chunk);
      if (r) result = r;
    }
    expect(result?.sdp).toBe(sdp);
  });

  it("returns null until every chunk has arrived, and never double-counts a duplicate", () => {
    const sdp = "y".repeat(30000);
    const chunks = chunkSignal({ type: "offer", sdp });
    expect(chunks.length).toBeGreaterThan(2);

    const reassembler = new ChunkReassembler();
    expect(reassembler.push(chunks[0])).toBeNull();
    expect(reassembler.push(chunks[0])).toBeNull(); // duplicate, still incomplete
    for (let i = 1; i < chunks.length - 1; i++) {
      expect(reassembler.push(chunks[i])).toBeNull();
    }
    const result = reassembler.push(chunks[chunks.length - 1]);
    expect(result?.sdp).toBe(sdp);
  });
});

describe("encodeTagPrefix", () => {
  it("produces a @tag=value prefix with the escaped JSON envelope", () => {
    const env = { type: "mic", state: "on" };
    const prefix = encodeTagPrefix(env);
    expect(prefix).toBe(
      `@${RTC_TAG}=${escapeIrcTagValue(JSON.stringify(env))}`,
    );
  });
});
