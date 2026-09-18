// Device enumeration and constraint-building shared by the call-devices
// settings panel and the voice client. No store import here so either side
// can use it without a dependency cycle.

import { t } from "@lingui/core/macro";

export type SavedDevice = {
  deviceId: string;
  label: string;
};

export type DeviceKind = "audioinput" | "videoinput" | "audiooutput";

/** The slice of GlobalSettings these helpers read. Structural, not imported
 *  from the store, so this module stays store-free; the real GlobalSettings
 *  object satisfies it as-is. */
export interface GlobalSettingsSlice {
  callAudioInput: SavedDevice | null;
  callVideoInput: SavedDevice | null;
  callCameraFacing: "user" | "environment";
  callEchoCancellation: boolean;
  callNoiseSuppression: boolean;
  callAutoGainControl: boolean;
}

// Left unconstrained a phone publishes whatever its camera likes, up to 1080p,
// and the SFU then fans that out to everyone in the room. `ideal` and `max`
// rather than `exact` so a device that cannot match still returns a track.
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "user" },
  width: { max: 1280 },
  height: { max: 720 },
  frameRate: { max: 30 },
};

export async function listDevices(
  kind: DeviceKind,
): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === kind);
}

/** Saved id first, then exact label, then undefined for the system default.
 *  WebKit rotates ids per page load, so the label is what survives a restart. */
export function resolveDeviceId(
  saved: SavedDevice | null,
  devices: MediaDeviceInfo[],
): string | undefined {
  if (!saved) return undefined;
  if (devices.some((d) => d.deviceId === saved.deviceId)) {
    return saved.deviceId;
  }
  if (saved.label) {
    const byLabel = devices.find((d) => d.label === saved.label);
    if (byLabel) return byLabel.deviceId;
  }
  return undefined;
}

/** Shared by every field that opens a capture (microphone, camera), so a
 *  getUserMedia failure reads the same way wherever it happens. */
export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return t`Access was denied. Allow camera and microphone access in your browser or system settings, then try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return t`That device is not available right now.`;
  }
  // WebKit refuses a screen capture asked for by a window that is not in front
  // and has not just been clicked.
  if (name === "InvalidStateError") {
    return t`Bring this window to the front and try again.`;
  }
  return t`Could not access the device.`;
}

export function speakerSelectionSupported(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

export function screenCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

/** The one place we call getDisplayMedia. We ask for system audio, which some
 *  browsers ignore, and wire the video track's `ended` to onEnded so a share
 *  stopped from the browser's own control tears down like any other. */
export async function captureScreen(onEnded: () => void): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) videoTrack.onended = onEnded;
  return stream;
}

/** A self-preview mirrors, except on a back camera, which shows the world
 *  rather than yourself. */
export function mirrorsCamera(
  isTouch: boolean,
  facing: "user" | "environment",
): boolean {
  return isTouch ? facing === "user" : true;
}

export function audioConstraints(
  s: GlobalSettingsSlice,
  deviceId?: string,
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: s.callEchoCancellation,
    noiseSuppression: s.callNoiseSuppression,
    autoGainControl: s.callAutoGainControl,
  };
}

// On iOS, picking a camera by deviceId is unreliable, while facingMode is
// dependable -- so a touch device prefers the saved facing mode over a
// device id even when both are available.
export function videoConstraints(
  s: GlobalSettingsSlice,
  deviceId?: string,
  isTouch?: boolean,
): MediaTrackConstraints {
  if (isTouch) {
    return { ...VIDEO_CONSTRAINTS, facingMode: { ideal: s.callCameraFacing } };
  }
  if (deviceId) {
    return { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } };
  }
  return { ...VIDEO_CONSTRAINTS };
}
