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

import { CallCameraField } from "../../../src/components/ui/settings/CallCameraField";
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
  const track = { stop: vi.fn(), kind: "video" } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    track,
  } as unknown as MediaStream & { track: MediaStreamTrack };
}

let enumerateDevicesMock: ReturnType<typeof vi.fn>;
let getUserMediaMock: ReturnType<typeof vi.fn>;
let createdStreams: ReturnType<typeof makeStream>[];

const setting = {
  key: "callCameraDevice",
} as unknown as SettingComponentProps["setting"];

function setupStore() {
  const globalSettings = {
    callVideoInput: null,
    callCameraFacing: "user" as const,
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CallCameraField", () => {
  it("renders a camera picker once permission is already granted", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("videoinput", "cam-1", "FaceTime Camera"),
    ]);

    render(<CallCameraField setting={setting} value="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("option", { name: "FaceTime Camera" }),
    ).toBeInTheDocument();
  });

  it("shows the permission step when device labels are empty", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("videoinput", "cam-1", ""),
    ]);

    render(<CallCameraField setting={setting} value="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Device names are hidden until you allow/i),
      ).toBeInTheDocument();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("stops every track on unmount", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("videoinput", "cam-1", "FaceTime Camera"),
    ]);

    const { unmount } = render(
      <CallCameraField setting={setting} value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ video: expect.anything() }),
      );
    });

    const stream = createdStreams[0];
    expect(stream).toBeDefined();

    unmount();

    expect(stream?.track.stop).toHaveBeenCalled();
  });
});
