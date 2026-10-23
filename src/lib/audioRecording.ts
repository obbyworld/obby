// Safari before 18.4 records only MP4/AAC, and that is what the desktop and
// iOS apps run, so the MP4 fallback is what makes recording work there.

export interface RecordingFormat {
  mimeType: string;
  extension: string;
}

const AUDIO_CANDIDATES: RecordingFormat[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/mp4", extension: "m4a" },
];

const VIDEO_CANDIDATES: RecordingFormat[] = [
  { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
  { mimeType: "video/mp4", extension: "mp4" },
];

function defaultIsTypeSupported(mimeType: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported(mimeType)
  );
}

function pickFormat(
  candidates: RecordingFormat[],
  isTypeSupported: (mimeType: string) => boolean,
): RecordingFormat | null {
  return candidates.find((f) => isTypeSupported(f.mimeType)) ?? null;
}

/** The best audio format MediaRecorder can actually produce here, or null
 *  when it can produce none of them. `isTypeSupported` is injectable so
 *  tests don't need a real MediaRecorder. */
export function pickRecordingFormat(
  isTypeSupported: (mimeType: string) => boolean = defaultIsTypeSupported,
): RecordingFormat | null {
  return pickFormat(AUDIO_CANDIDATES, isTypeSupported);
}

/** Same probe as pickRecordingFormat, against the video candidate list. */
export function pickVideoRecordingFormat(
  isTypeSupported: (mimeType: string) => boolean = defaultIsTypeSupported,
): RecordingFormat | null {
  return pickFormat(VIDEO_CANDIDATES, isTypeSupported);
}

/** A name a person can recognise in a channel: dated, with the extension
 *  the recording actually was saved in. */
export function recordingFileName(
  prefix: string,
  extension: string,
  at: Date = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${prefix}-${stamp}.${extension}`;
}
