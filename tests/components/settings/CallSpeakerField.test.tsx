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

import { CallSpeakerField } from "../../../src/components/ui/settings/CallSpeakerField";
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

let enumerateDevicesMock: ReturnType<typeof vi.fn>;
let getUserMediaMock: ReturnType<typeof vi.fn>;

const setting = {
  key: "callSpeakerDevice",
} as unknown as SettingComponentProps["setting"];

function setupStore() {
  const globalSettings = {
    callAudioOutput: null,
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
  getUserMediaMock = vi.fn(() =>
    Promise.resolve({ getTracks: () => [] } as unknown as MediaStream),
  );
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
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)
    .setSinkId;
});

describe("CallSpeakerField", () => {
  it("renders a speaker picker once permission is already granted", async () => {
    (
      HTMLMediaElement.prototype as unknown as Record<string, unknown>
    ).setSinkId = vi.fn();
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audiooutput", "spk-1", "Built-in Speaker"),
    ]);

    render(<CallSpeakerField setting={setting} value="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("option", { name: "Built-in Speaker" }),
    ).toBeInTheDocument();
  });

  it("shows the permission step when device labels are empty", async () => {
    (
      HTMLMediaElement.prototype as unknown as Record<string, unknown>
    ).setSinkId = vi.fn();
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audiooutput", "spk-1", ""),
    ]);

    render(<CallSpeakerField setting={setting} value="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Browsers only reveal your speakers/i),
      ).toBeInTheDocument();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("shows an explanatory message instead of the picker when unsupported", async () => {
    enumerateDevicesMock.mockResolvedValue([
      fakeDevice("audiooutput", "spk-1", "Built-in Speaker"),
    ]);

    render(<CallSpeakerField setting={setting} value="" onChange={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Speaker selection isn't supported in this browser/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
