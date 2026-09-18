import type { RecordingFormat } from "./audioRecording";
import { recordingFileName } from "./audioRecording";
import {
  AUDIO_BITS_PER_SECOND,
  MAX_RECORDING_MS,
  VIDEO_BITS_PER_SECOND,
} from "./recordingLimits";

export type AutoStopReason = "size-limit" | "duration-limit";

export interface LimitedRecordingOptions {
  format: RecordingFormat;
  filePrefix: string;
  /** Upload ceiling the recording stops itself at. See recordingLimits.ts. */
  maxBytes: number;
  video: boolean;
}

export interface LimitedRecordingCallbacks {
  onProgress: (progress: { elapsedMs: number; sizeBytes: number }) => void;
  onFile: (file: File, stoppedBy: AutoStopReason | null) => void;
}

export interface LimitedRecording {
  /** Ends the recording and hands the file to onFile. */
  stop: () => void;
  /** Drops everything without producing a file. */
  release: () => void;
}

const TICK_MS = 250;

/** Records a stream under both a size and a duration ceiling, so a take always
 *  stays sendable however long someone leaves it running. */
export function startLimitedRecording(
  stream: MediaStream,
  { format, filePrefix, maxBytes, video }: LimitedRecordingOptions,
  { onProgress, onFile }: LimitedRecordingCallbacks,
): LimitedRecording {
  const chunks: Blob[] = [];
  let bytes = 0;
  let stoppedBy: AutoStopReason | null = null;
  let released = false;
  const startedAt = Date.now();

  const options: MediaRecorderOptions = { mimeType: format.mimeType };
  if (video) {
    options.videoBitsPerSecond = VIDEO_BITS_PER_SECOND;
    options.audioBitsPerSecond = AUDIO_BITS_PER_SECOND;
  }
  const recorder = new MediaRecorder(stream, options);

  const tick = window.setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    onProgress({ elapsedMs, sizeBytes: bytes });
    if (elapsedMs >= MAX_RECORDING_MS && recorder.state === "recording") {
      stoppedBy = "duration-limit";
      recorder.stop();
    }
  }, TICK_MS);

  const clearTick = () => window.clearInterval(tick);

  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    chunks.push(e.data);
    bytes += e.data.size;
    onProgress({ elapsedMs: Date.now() - startedAt, sizeBytes: bytes });
    if (bytes >= maxBytes && recorder.state === "recording") {
      stoppedBy = "size-limit";
      recorder.stop();
    }
  };

  recorder.onstop = () => {
    clearTick();
    if (released) return;
    const blob = new Blob(chunks, { type: format.mimeType });
    const file = new File(
      [blob],
      recordingFileName(filePrefix, format.extension),
      { type: format.mimeType },
    );
    onFile(file, stoppedBy);
  };

  // We timeslice so the size ceiling is enforced while recording.
  recorder.start(1000);

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
    release: () => {
      released = true;
      clearTick();
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
