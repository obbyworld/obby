import type { UploadInfo } from "./mediaUpload";

// At these rates five minutes lands near 60 MB, so a take stays sendable to a
// filehost capping uploads around 100 MB.
export const VIDEO_BITS_PER_SECOND = 1_500_000;
export const AUDIO_BITS_PER_SECOND = 64_000;

// A recording stops itself even where no server policy is known.
export const MAX_RECORDING_MS = 5 * 60_000;

export const FALLBACK_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// We stop short of the stated cap to leave room for container overhead.
const SIZE_SAFETY_MARGIN = 0.95;

/** The byte ceiling a recording should stop itself at, given the server's
 *  upload policy (or null when none is known). */
export function maxRecordingBytes(info: UploadInfo | null): number {
  const max =
    info?.max_size && info.max_size > 0
      ? info.max_size
      : FALLBACK_MAX_UPLOAD_BYTES;
  return Math.floor(max * SIZE_SAFETY_MARGIN);
}
