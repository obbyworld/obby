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

import { CameraCaptureModal } from "../../src/components/ui/CameraCaptureModal";
import useStore from "../../src/store";

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
class FakeMediaStream {
  constructor(public tracks: MediaStreamTrack[] = []) {}
}
vi.stubGlobal("MediaStream", FakeMediaStream);

const mockStore = vi.mocked(useStore);
const mockGetState = vi.mocked(useStore.getState);

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions,
  ) {
    recorders.push(this);
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
}

let recorders: FakeMediaRecorder[];
let tracks: { stop: ReturnType<typeof vi.fn> }[];

function makeStream() {
  const track = { stop: vi.fn(), kind: "video" } as unknown as MediaStreamTrack;
  tracks.push(track as unknown as { stop: ReturnType<typeof vi.fn> });
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
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
  mockStore.mockImplementation((selector) =>
    typeof selector === "function"
      ? selector(state as never)
      : (state as never),
  );
  mockGetState.mockReturnValue(state as never);
}

beforeEach(() => {
  setupStore();
  recorders = [];
  tracks = [];
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        {
          kind: "videoinput",
          deviceId: "cam-1",
          label: "Camera",
          groupId: "g",
          toJSON: () => ({}),
        },
      ]),
      getUserMedia: vi.fn(() => Promise.resolve(makeStream())),
    },
    configurable: true,
    writable: true,
  });
  window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  URL.createObjectURL = vi.fn(() => "blob:capture");
  URL.revokeObjectURL = vi.fn();
  // jsdom reports a zero-sized video and draws nothing, so the photo path
  // needs a frame to exist and an encoder to answer.
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    value: 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    value: 480,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
    callback(new Blob(["image"]));
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function renderModal(props: Partial<Parameters<typeof CameraCaptureModal>[0]>) {
  const onCaptured = vi.fn();
  const onClose = vi.fn();
  render(
    <CameraCaptureModal
      isOpen
      onClose={onClose}
      onCaptured={onCaptured}
      maxBytes={1_000_000}
      {...props}
    />,
  );
  return { onCaptured, onClose };
}

async function waitForViewfinder() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /take photo/i })).toBeEnabled(),
  );
}

describe("CameraCaptureModal", () => {
  // The camera opens on a viewfinder: nothing is recorded until it is asked
  // for, so opening the camera to look is not the same as capturing.
  it("shows a viewfinder without recording anything", async () => {
    renderModal({});
    await waitForViewfinder();

    expect(recorders).toHaveLength(0);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("takes a photo without ever starting a recording", async () => {
    const { onCaptured } = renderModal({});
    await waitForViewfinder();

    fireEvent.click(screen.getByRole("button", { name: /take photo/i }));

    const send = await screen.findByRole("button", { name: /send/i });
    expect(screen.getByAltText(/photo you just took/i)).toBeInTheDocument();
    expect(recorders).toHaveLength(0);

    fireEvent.click(send);
    expect(onCaptured).toHaveBeenCalledTimes(1);
    const file = onCaptured.mock.calls[0][0] as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toMatch(/^photo-.*\.jpg$/);
  });

  it("records only once the shutter is pressed in video mode", async () => {
    const { onCaptured } = renderModal({});
    await waitForViewfinder();

    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(recorders).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    // The take is reviewed before it goes anywhere.
    expect(onCaptured).not.toHaveBeenCalled();
    const send = await screen.findByRole("button", { name: /send/i });
    fireEvent.click(send);
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured.mock.calls[0][0].name).toMatch(/^video-message-/);
  });

  it("sends nothing when the take is discarded", async () => {
    const { onCaptured } = renderModal({});
    await waitForViewfinder();

    fireEvent.click(screen.getByRole("button", { name: /^video$/i }));
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    fireEvent.click(await screen.findByRole("button", { name: /retake/i }));

    expect(onCaptured).not.toHaveBeenCalled();
    // Back on the viewfinder, still in the mode that was chosen.
    expect(
      screen.getByRole("button", { name: /start recording/i }),
    ).toBeInTheDocument();
  });

  it("releases the camera when it is closed", async () => {
    const { onClose } = renderModal({});
    await waitForViewfinder();

    fireEvent.click(screen.getByRole("button", { name: /close modal/i }));

    expect(onClose).toHaveBeenCalled();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
  });
});
