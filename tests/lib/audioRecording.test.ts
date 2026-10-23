import { describe, expect, it } from "vitest";
import {
  pickRecordingFormat,
  pickVideoRecordingFormat,
  recordingFileName,
} from "../../src/lib/audioRecording";

describe("pickRecordingFormat", () => {
  it("picks the preferred supported type", () => {
    const format = pickRecordingFormat(() => true);
    expect(format).toEqual({
      mimeType: "audio/webm;codecs=opus",
      extension: "webm",
    });
  });

  it("falls back to MP4 when only that is supported", () => {
    const format = pickRecordingFormat((mimeType) => mimeType === "audio/mp4");
    expect(format).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
  });

  it("skips to the next candidate when the preferred one is unsupported", () => {
    const format = pickRecordingFormat(
      (mimeType) => mimeType === "audio/ogg;codecs=opus",
    );
    expect(format).toEqual({
      mimeType: "audio/ogg;codecs=opus",
      extension: "ogg",
    });
  });

  it("returns null when nothing is supported", () => {
    expect(pickRecordingFormat(() => false)).toBeNull();
  });
});

describe("pickVideoRecordingFormat", () => {
  it("prefers VP9", () => {
    const format = pickVideoRecordingFormat(() => true);
    expect(format).toEqual({
      mimeType: "video/webm;codecs=vp9,opus",
      extension: "webm",
    });
  });

  it("falls back to VP8 when VP9 is unsupported", () => {
    const format = pickVideoRecordingFormat(
      (mimeType) => mimeType === "video/webm;codecs=vp8,opus",
    );
    expect(format).toEqual({
      mimeType: "video/webm;codecs=vp8,opus",
      extension: "webm",
    });
  });

  it("falls back to MP4 when only that is supported", () => {
    const format = pickVideoRecordingFormat(
      (mimeType) => mimeType === "video/mp4",
    );
    expect(format).toEqual({ mimeType: "video/mp4", extension: "mp4" });
  });

  it("returns null when nothing is supported", () => {
    expect(pickVideoRecordingFormat(() => false)).toBeNull();
  });
});

describe("recordingFileName", () => {
  it("names the file with the prefix, date, and given extension", () => {
    const at = new Date(2026, 8, 11, 15, 4, 5);
    expect(recordingFileName("voice-message", "webm", at)).toBe(
      "voice-message-2026-09-11-150405.webm",
    );
  });

  it("uses whatever prefix the caller gives it", () => {
    const at = new Date(2026, 8, 11, 15, 4, 5);
    expect(recordingFileName("screen-recording", "webm", at)).toBe(
      "screen-recording-2026-09-11-150405.webm",
    );
  });
});
