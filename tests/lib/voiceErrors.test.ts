import { describe, expect, it } from "vitest";
import { deviceErrorCode } from "../../src/lib/voiceErrors";

describe("deviceErrorCode", () => {
  it("reports a denied permission as blocked", () => {
    expect(
      deviceErrorCode("mic", new DOMException("denied", "NotAllowedError")),
    ).toBe("mic-blocked");
  });

  it("reports an absent device as missing", () => {
    expect(
      deviceErrorCode("camera", new DOMException("none", "NotFoundError")),
    ).toBe("camera-missing");
  });

  it("asks for the window in front when WebKit refuses a background capture", () => {
    expect(
      deviceErrorCode("screen", new DOMException("bg", "InvalidStateError")),
    ).toBe("screen-not-front");
  });

  it("reports anything else as failed", () => {
    expect(deviceErrorCode("screen", new Error("boom"))).toBe("screen-failed");
  });
});
