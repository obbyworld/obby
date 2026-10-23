import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/store", () => {
  const mockStoreFn = vi.fn();
  const mockGetState = vi.fn();
  return {
    default: Object.assign(mockStoreFn, { getState: mockGetState }),
  };
});

import { RecordingPanel } from "../../src/components/ui/RecordingPanel";
import useStore from "../../src/store";

// jsdom doesn't implement HTMLMediaElement.play or MediaStream -- the video
// and screen previews route through VideoTrackView, which needs both.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
class FakeMediaStream {
  tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
}
vi.stubGlobal("MediaStream", FakeMediaStream);

const mockStore = vi.mocked(useStore);
const mockGetState = vi.mocked(useStore.getState);

function fakeDevice(
  kind: MediaDeviceKind,
  deviceId: string,
  label = "",
): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: "group",
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

function makeStream(kind: "audio" | "video" = "audio") {
  const track = { stop: vi.fn(), kind } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getVideoTracks: () => (kind === "video" ? [track] : []),
    getAudioTracks: () => (kind === "audio" ? [track] : []),
    track,
  } as unknown as MediaStream & { track: MediaStreamTrack };
}

// The level the fake microphone reports: zero while the device is still
// switching over, then the noise floor of a live one.
let micSample: number;

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 32,
      frequencyBinCount: 32,
      getByteFrequencyData: vi.fn(),
      getFloatTimeDomainData: (samples: Float32Array) =>
        samples.fill(micSample),
    };
  }
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions,
  ) {
    fakeRecorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"]) });
    this.onstop?.();
  }
  /** Test helper: simulate one MediaRecorder timeslice tick emitting a real
   *  chunk of the given byte size, without actually stopping. */
  emitChunk(size: number) {
    if (this.state !== "recording") return;
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
}

let fakeRecorders: FakeMediaRecorder[];
let enumerateDevicesMock: ReturnType<typeof vi.fn>;
let getUserMediaMock: ReturnType<typeof vi.fn>;
let getDisplayMediaMock: ReturnType<typeof vi.fn>;
let createdStreams: ReturnType<typeof makeStream>[];

function anchorEl(): HTMLElement {
  const el = document.createElement("button");
  document.body.appendChild(el);
  return el;
}

function setupStore() {
  const globalSettings = {
    callAudioInput: null,
    callVideoInput: null,
    callCameraFacing: "user" as const,
    callEchoCancellation: true,
    callNoiseSuppression: true,
    callAutoGainControl: true,
  };
  const state = {
    globalSettings,
    updateGlobalSettings: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(globalSettings, patch);
    }),
  };
  mockStore.mockImplementation((selector) => {
    if (typeof selector === "function") return selector(state as never);
    return state as never;
  });
  mockGetState.mockReturnValue(state as never);
}

beforeEach(() => {
  setupStore();
  fakeRecorders = [];
  micSample = 0.01;

  enumerateDevicesMock = vi
    .fn()
    .mockResolvedValue([
      fakeDevice("audioinput", "mic-1", "Microphone"),
      fakeDevice("videoinput", "cam-1", "Camera"),
    ]);
  createdStreams = [];
  getUserMediaMock = vi.fn((constraints: MediaStreamConstraints) => {
    const stream = makeStream(constraints.video ? "video" : "audio");
    createdStreams.push(stream);
    return Promise.resolve(stream);
  });
  getDisplayMediaMock = vi.fn(() => {
    const stream = makeStream("video");
    createdStreams.push(stream);
    return Promise.resolve(stream);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: enumerateDevicesMock,
      getUserMedia: getUserMediaMock,
      getDisplayMedia: getDisplayMediaMock,
    },
    configurable: true,
    writable: true,
  });

  window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  window.requestAnimationFrame = vi.fn(() => 1);
  window.cancelAnimationFrame = vi.fn();
  window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("RecordingPanel: audio", () => {
  it("hands a file with the recorded extension to onRecorded when stopped", async () => {
    const onRecorded = vi.fn();
    const onClose = vi.fn();
    render(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={onClose}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^voice-message-.*\.webm$/);
    expect(onClose).toHaveBeenCalled();
  });

  it("records from the moment the microphone opens and asks to wait while it is silent", async () => {
    micSample = 0;
    render(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(1));
    expect(screen.getByText(/start talking/i)).toBeInTheDocument();
  });

  it("drops the hint once the microphone delivers sound", async () => {
    render(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText(/start talking/i)).not.toBeInTheDocument(),
    );
  });

  it("discarding closes without handing anything onward and stops tracks", async () => {
    const onRecorded = vi.fn();
    const onClose = vi.fn();
    render(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={onClose}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    const stream = createdStreams[0];

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    expect(onRecorded).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it("stops every track on unmount", async () => {
    const { unmount } = render(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    const stream = createdStreams[0];

    unmount();

    expect(stream.track.stop).toHaveBeenCalled();
  });
});

describe("RecordingPanel: video", () => {
  it("shows the permission gate instead of recording when device labels are hidden", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("videoinput", "cam-1", ""),
    ]);

    render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Device names are hidden until you allow/i),
      ).toBeInTheDocument();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("records a camera clip and hands a .webm file to onRecorded", async () => {
    const onRecorded = vi.fn();
    render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ video: expect.anything() }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^video-message-.*\.webm$/);
  });

  // Picking a different kind while the panel is open used to leave the first
  // capture running and hand back its file under the second kind's label.
  it("retakes the capture when the kind changes under an open panel", async () => {
    const onRecorded = vi.fn();
    const { rerender } = render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(1));
    const cameraTracks = createdStreams[0].getTracks();

    rerender(
      <RecordingPanel
        kind="audio"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(2));
    for (const track of cameraTracks) expect(track.stop).toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^voice-message-/);
  });

  // Flipping the camera restarts the capture, so offering it mid-take would
  // throw away what the user had already recorded.
  it("locks the camera flip while recording", async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("coarse"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: /^front$/i })).toBeDisabled();
  });

  it("caps the encoder bitrate so a long clip stays well under the upload limit", async () => {
    render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={vi.fn()}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(1));
    expect(fakeRecorders[0].options?.videoBitsPerSecond).toBe(1_500_000);
    expect(fakeRecorders[0].options?.audioBitsPerSecond).toBe(64_000);
  });

  it("reaching the size limit stops the recording, keeps the file, and explains why", async () => {
    const onRecorded = vi.fn();
    render(
      <RecordingPanel
        kind="video"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        maxBytes={5000}
      />,
    );

    await waitFor(() => expect(fakeRecorders).toHaveLength(1));
    const recorder = fakeRecorders[0];
    await waitFor(() => expect(recorder.state).toBe("recording"));

    recorder.emitChunk(3000);
    recorder.emitChunk(3000);

    await waitFor(() =>
      expect(
        screen.getByText(/Reached the upload size limit/i),
      ).toBeInTheDocument(),
    );
    expect(onRecorded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /attach/i }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^video-message-.*\.webm$/);
  });
});

describe("RecordingPanel: screen", () => {
  it("captures the screen via getDisplayMedia and hands a file to onRecorded", async () => {
    const onRecorded = vi.fn();
    render(
      <RecordingPanel
        kind="screen"
        isOpen
        anchor={anchorEl()}
        onClose={vi.fn()}
        onRecorded={onRecorded}
        maxBytes={100 * 1024 * 1024}
      />,
    );

    await waitFor(() => expect(getDisplayMediaMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const file = onRecorded.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^screen-recording-.*\.webm$/);
  });
});
