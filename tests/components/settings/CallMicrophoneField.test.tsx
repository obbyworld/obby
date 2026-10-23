import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingComponentProps } from "../../../src/lib/settings/types";

vi.mock("../../../src/store", () => {
  const mockStoreFn = vi.fn();
  const mockGetState = vi.fn();
  const mockSetState = vi.fn();
  return {
    default: Object.assign(mockStoreFn, {
      getState: mockGetState,
      setState: mockSetState,
    }),
  };
});

import { CallMicrophoneField } from "../../../src/components/ui/settings/CallMicrophoneField";
import useStore from "../../../src/store";

const mockStore = vi.mocked(useStore);
const mockGetState = vi.mocked(useStore.getState);

function fakeDevice(
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: "group",
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

function makeStream() {
  const track = { stop: vi.fn(), kind: "audio" } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    track,
  } as unknown as MediaStream & { track: MediaStreamTrack };
}

const mockAudioClose = vi.fn(() => Promise.resolve());

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 32,
      getByteFrequencyData: vi.fn(),
    };
  }
  close = mockAudioClose;
}

let enumerateDevicesMock: ReturnType<typeof vi.fn>;
let getUserMediaMock: ReturnType<typeof vi.fn>;
let createdStreams: ReturnType<typeof makeStream>[];

const setting = {
  key: "callMicrophoneDevice",
} as unknown as SettingComponentProps["setting"];

function setupStore() {
  const globalSettings = {
    callAudioInput: null,
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

  enumerateDevicesMock = vi.fn().mockResolvedValue([]);
  createdStreams = [];
  getUserMediaMock = vi.fn(() => {
    const stream = makeStream();
    createdStreams.push(stream);
    return Promise.resolve(stream);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: enumerateDevicesMock,
      getUserMedia: getUserMediaMock,
    },
    configurable: true,
    writable: true,
  });

  window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  window.requestAnimationFrame = vi.fn(() => 1);
  window.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CallMicrophoneField", () => {
  it("renders a microphone picker once permission is already granted", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audioinput", "mic-1", "Built-in Microphone"),
    ]);

    render(
      <CallMicrophoneField setting={setting} value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("option", { name: "Built-in Microphone" }),
    ).toBeInTheDocument();
  });

  it("shows the permission step when device labels are empty", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audioinput", "mic-1", ""),
    ]);

    render(
      <CallMicrophoneField setting={setting} value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Device names are hidden until you allow/i),
      ).toBeInTheDocument();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  // WebKit returns nothing at all before access is granted, where Chromium
  // returns devices with blank labels. Reading only the label left the panel
  // showing neither a picker nor a way to ask.
  it("offers the permission step when the device list comes back empty", async () => {
    enumerateDevicesMock.mockResolvedValue([]);

    render(
      <CallMicrophoneField setting={setting} value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Device names are hidden until you allow/i),
      ).toBeInTheDocument();
    });
  });

  it("stops every track and closes the audio context on unmount", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audioinput", "mic-1", "Built-in Microphone"),
    ]);

    const { unmount } = render(
      <CallMicrophoneField setting={setting} value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ audio: expect.anything() }),
      );
    });

    const stream = createdStreams[0];
    expect(stream).toBeDefined();

    unmount();

    await waitFor(() => {
      expect(mockAudioClose).toHaveBeenCalled();
    });
    expect(stream?.track.stop).toHaveBeenCalled();
  });
});
