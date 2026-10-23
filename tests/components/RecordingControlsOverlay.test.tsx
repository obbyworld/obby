import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/screenRegion", () => ({
  requestRecordingStop: vi.fn(() => Promise.resolve()),
  requestRecordingCancel: vi.fn(() => Promise.resolve()),
}));

import { RecordingControlsOverlay } from "../../src/components/ui/RecordingControlsOverlay";
import {
  requestRecordingCancel,
  requestRecordingStop,
} from "../../src/lib/screenRegion";

const stop = vi.mocked(requestRecordingStop);
const cancel = vi.mocked(requestRecordingCancel);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecordingControlsOverlay", () => {
  // This bar is the only thing on screen that can end the recording, since the
  // app window is behind whatever is being recorded.
  it("stops the recording from its own button", () => {
    render(<RecordingControlsOverlay />);

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(stop).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("throws the recording away from its own button", () => {
    render(<RecordingControlsOverlay />);

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    expect(cancel).toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("takes enter and escape, so neither hand has to find the mouse", () => {
    render(<RecordingControlsOverlay />);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(stop).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("shows a running clock", () => {
    render(<RecordingControlsOverlay />);

    expect(screen.getByText(/^\d+:\d{2}$/)).toBeInTheDocument();
  });
});
