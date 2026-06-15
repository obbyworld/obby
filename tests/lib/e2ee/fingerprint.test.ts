import { describe, expect, test } from "vitest";
import {
  combinedFingerprint,
  formatFingerprint,
} from "../../../src/lib/e2ee/fingerprint";

describe("formatFingerprint", () => {
  test("groups hex into the requested layout", () => {
    const bytes = new Uint8Array([
      0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      0xfe, 0xed, 0xfa, 0xce,
    ]);
    expect(formatFingerprint(bytes)).toBe(
      "DEAD BEEF 0123 4567 89AB CDEF FEED FACE",
    );
  });

  test("custom grouping", () => {
    const bytes = new Uint8Array([0xab, 0xcd, 0xef]);
    expect(formatFingerprint(bytes, 2, 3)).toBe("AB CD EF");
  });

  test("pads each byte to two hex digits", () => {
    const bytes = new Uint8Array([0x00, 0x0f]);
    expect(formatFingerprint(bytes, 2, 2)).toBe("00 0F");
  });
});

describe("combinedFingerprint", () => {
  test("is order-independent so both peers see the same string", () => {
    const a = "DEAD BEEF";
    const b = "0123 4567";
    expect(combinedFingerprint(a, b)).toBe(combinedFingerprint(b, a));
  });

  test("sorts deterministically", () => {
    expect(combinedFingerprint("BBBB", "AAAA")).toBe("AAAA  BBBB");
  });
});
