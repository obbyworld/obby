import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startLimitedRecording } from "../../src/lib/limitedRecording";
import { MAX_RECORDING_MS } from "../../src/lib/recordingLimits";

const FORMAT = { mimeType: "video/webm", extension: "webm" };

class FakeRecorder {
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options: MediaRecorderOptions,
  ) {
    FakeRecorder.last = this;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }

  emit(size: number) {
    this.ondataavailable?.({ data: new Blob(["x".repeat(size)]) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.last = null;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeStream(audioTracks: number): MediaStream {
  return {
    getAudioTracks: () => Array.from({ length: audioTracks }),
  } as unknown as MediaStream;
}

function start(
  maxBytes: number,
  onFile = vi.fn(),
  onProgress = vi.fn(),
  { stream = fakeStream(1), format = FORMAT } = {},
) {
  const handle = startLimitedRecording(
    stream,
    { format, filePrefix: "video-message", maxBytes, video: true },
    { onProgress, onFile },
  );
  // biome-ignore lint/style/noNonNullAssertion: the recorder is constructed above
  return { handle, recorder: FakeRecorder.last!, onFile, onProgress };
}

describe("startLimitedRecording", () => {
  test("hands over a named file when it is stopped", () => {
    const { handle, recorder, onFile } = start(1_000);
    recorder.emit(10);

    handle.stop();

    expect(onFile).toHaveBeenCalledTimes(1);
    const [file, reason] = onFile.mock.calls[0];
    expect(file.name).toMatch(/^video-message-.*\.webm$/);
    expect(file.type).toBe("video/webm");
    expect(reason).toBeNull();
  });

  // Firefox never fires onstop for a vp8,opus recorder on a stream with no
  // audio track, which is what window capture and a lone camera hand us.
  test("drops the audio codec when the stream has no audio track", () => {
    const { handle, recorder, onFile } = start(1_000, vi.fn(), vi.fn(), {
      stream: fakeStream(0),
      format: { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    });

    handle.stop();

    expect(recorder.options.mimeType).toBe("video/webm;codecs=vp8");
    expect(onFile.mock.calls[0][0].type).toBe("video/webm;codecs=vp8");
  });

  // A take that outgrows the server's cap can never be sent, so it stops
  // itself and says why rather than being discovered at upload time.
  test("stops itself at the size ceiling", () => {
    const { recorder, onFile } = start(20);

    recorder.emit(25);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][1]).toBe("size-limit");
  });

  test("stops itself at the length ceiling", () => {
    const { recorder, onFile } = start(1_000_000);

    vi.advanceTimersByTime(MAX_RECORDING_MS + 250);

    expect(recorder.state).toBe("inactive");
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][1]).toBe("duration-limit");
  });

  test("releasing produces no file and stops the ticking", () => {
    const { handle, recorder, onFile, onProgress } = start(1_000);

    handle.release();
    onProgress.mockClear();
    vi.advanceTimersByTime(1_000);

    expect(recorder.state).toBe("inactive");
    expect(onFile).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  test("reports growing size and elapsed time", () => {
    const { recorder, onProgress } = start(1_000_000);

    recorder.emit(40);
    vi.advanceTimersByTime(250);

    const last = onProgress.mock.calls.at(-1)?.[0];
    expect(last.sizeBytes).toBe(40);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(250);
  });
});
