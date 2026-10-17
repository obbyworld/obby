import { describe, expect, it } from "vitest";
import {
  FALLBACK_MAX_UPLOAD_BYTES,
  maxRecordingBytes,
} from "../../src/lib/recordingLimits";

describe("maxRecordingBytes", () => {
  it("falls back to the default cap when no policy is known", () => {
    expect(maxRecordingBytes(null)).toBe(
      Math.floor(FALLBACK_MAX_UPLOAD_BYTES * 0.95),
    );
  });

  it("falls back when the server reports no size cap", () => {
    expect(
      maxRecordingBytes({
        max_size: 0,
        allowed_extensions: [],
        scanning_enabled: false,
      }),
    ).toBe(Math.floor(FALLBACK_MAX_UPLOAD_BYTES * 0.95));
  });

  it("uses the server's real limit with a safety margin", () => {
    expect(
      maxRecordingBytes({
        max_size: 10 * 1024 * 1024,
        allowed_extensions: [],
        scanning_enabled: false,
      }),
    ).toBe(Math.floor(10 * 1024 * 1024 * 0.95));
  });
});
