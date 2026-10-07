import { t } from "@lingui/core/macro";
import { classifyMediaError, type MediaErrorKind } from "./mediaDevices";

type VoiceDeviceKind = "mic" | "camera" | "screen";

// We pass codes from the voice client to the view so every message is
// translated, and the call server's own text never reaches the screen.
export type VoiceErrorCode = `${VoiceDeviceKind}-${MediaErrorKind}` | "server";

export function deviceErrorCode(
  kind: VoiceDeviceKind,
  err: unknown,
): VoiceErrorCode {
  return `${kind}-${classifyMediaError(err)}`;
}

export function describeVoiceError(code: VoiceErrorCode): string {
  switch (code) {
    case "mic-blocked":
      return t`Allow microphone access in settings to talk`;
    case "mic-missing":
      return t`Connect a microphone to talk`;
    case "camera-blocked":
      return t`Allow camera access in settings to share video`;
    case "camera-missing":
      return t`Connect a camera to share video`;
    case "mic-not-front":
    case "camera-not-front":
    case "screen-not-front":
      return t`Bring this window to the front and try again.`;
    case "mic-failed":
      return t`Turn the mic on to try again`;
    case "camera-failed":
      return t`Turn the camera on to try again`;
    case "screen-blocked":
    case "screen-missing":
    case "screen-failed":
      return t`Share your screen again to retry`;
    case "server":
      return t`The call server refused that. Try again in a moment.`;
  }
}
