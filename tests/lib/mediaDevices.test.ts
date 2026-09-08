import { describe, expect, it } from "vitest";
import {
  audioConstraints,
  resolveDeviceId,
  speakerSelectionSupported,
  videoConstraints,
} from "../../src/lib/mediaDevices";

function device(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    label,
    kind: "audioinput",
    groupId: "",
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

describe("resolveDeviceId", () => {
  it("prefers a matching id", () => {
    const devices = [device("a", "Mic A"), device("b", "Mic B")];
    const result = resolveDeviceId({ deviceId: "b", label: "Mic B" }, devices);
    expect(result).toBe("b");
  });

  it("falls back to a matching label when the saved id is gone (WebKit rotates ids)", () => {
    const devices = [device("new-id", "Mic B")];
    const result = resolveDeviceId(
      { deviceId: "old-id", label: "Mic B" },
      devices,
    );
    expect(result).toBe("new-id");
  });

  it("returns undefined when neither id nor label match", () => {
    const devices = [device("a", "Mic A")];
    const result = resolveDeviceId(
      { deviceId: "old-id", label: "Unplugged Mic" },
      devices,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when there is no saved device", () => {
    const devices = [device("a", "Mic A")];
    expect(resolveDeviceId(null, devices)).toBeUndefined();
  });
});

describe("speakerSelectionSupported", () => {
  it("reflects whether HTMLMediaElement exposes setSinkId", () => {
    const proto = HTMLMediaElement.prototype as unknown as Record<
      string,
      unknown
    >;
    const had = "setSinkId" in proto;
    if (!had) proto.setSinkId = () => Promise.resolve();
    expect(speakerSelectionSupported()).toBe(true);
    if (!had) delete proto.setSinkId;
  });
});

const baseSettings = {
  callAudioInput: null,
  callVideoInput: null,
  callCameraFacing: "user" as const,
  callEchoCancellation: true,
  callNoiseSuppression: true,
  callAutoGainControl: true,
};

describe("audioConstraints", () => {
  it("carries the processing toggles and an exact device id when given", () => {
    expect(audioConstraints(baseSettings, "mic-1")).toEqual({
      deviceId: { exact: "mic-1" },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("omits deviceId for the system default", () => {
    expect(audioConstraints(baseSettings)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });
});

describe("videoConstraints", () => {
  it("uses the saved facing mode on touch devices even with a device id", () => {
    const c = videoConstraints(
      { ...baseSettings, callCameraFacing: "environment" },
      "cam-1",
      true,
    );
    expect(c.facingMode).toEqual({ ideal: "environment" });
    expect(c.deviceId).toBeUndefined();
  });

  it("targets an exact device id on pointer devices", () => {
    const c = videoConstraints(baseSettings, "cam-1", false);
    expect(c.deviceId).toEqual({ exact: "cam-1" });
  });

  it("falls back to the default facing mode with no device and no touch", () => {
    const c = videoConstraints(baseSettings);
    expect(c.facingMode).toEqual({ ideal: "user" });
    expect(c.deviceId).toBeUndefined();
  });
});
