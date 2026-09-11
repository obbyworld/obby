import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/geolocation", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/geolocation")
  >("../../src/lib/geolocation");
  return { ...actual, getCurrentLocation: vi.fn() };
});

import { LocationShareModal } from "../../src/components/ui/LocationShareModal";
import {
  GeolocationPermissionDeniedError,
  getCurrentLocation,
} from "../../src/lib/geolocation";

const mockGetCurrentLocation = vi.mocked(getCurrentLocation);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function waitForShareEnabled() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^share$/i })).toBeEnabled(),
  );
}

describe("LocationShareModal", () => {
  it("shows the target and shares a link built from the chosen precision", async () => {
    mockGetCurrentLocation.mockResolvedValue({
      latitude: 40.7127837,
      longitude: -74.0059413,
    });
    const onShare = vi.fn();
    render(
      <LocationShareModal
        isOpen
        target="#general"
        onCancel={vi.fn()}
        onShare={onShare}
      />,
    );

    expect(await screen.findByText(/#general/)).toBeInTheDocument();
    await waitForShareEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^exact$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(onShare).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=40.7127837&mlon=-74.0059413#map=17/40.7127837/-74.0059413",
    );
  });

  it("defaults to the rounded, approximate position", async () => {
    mockGetCurrentLocation.mockResolvedValue({
      latitude: 40.7127837,
      longitude: -74.0059413,
    });
    const onShare = vi.fn();
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={onShare}
      />,
    );
    await waitForShareEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(onShare).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=40.713&mlon=-74.006#map=14/40.713/-74.006",
    );
  });

  it("previews the map at the position the chosen precision would send", async () => {
    mockGetCurrentLocation.mockResolvedValue({
      latitude: 40.7127837,
      longitude: -74.0059413,
    });
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={vi.fn()}
      />,
    );
    await waitForShareEnabled();

    const approximateTile = screen
      .getAllByRole("presentation", { hidden: true })
      .find((img) => img.tagName === "IMG");
    expect(approximateTile).toBeTruthy();
    expect(approximateTile?.getAttribute("src")).toContain("14/");

    fireEvent.click(screen.getByRole("button", { name: /^exact$/i }));

    await waitFor(() => {
      const exactTile = screen
        .getAllByRole("presentation", { hidden: true })
        .find((img) => img.tagName === "IMG");
      expect(exactTile?.getAttribute("src")).toContain("17/");
    });
  });

  it("cancelling sends nothing", async () => {
    mockGetCurrentLocation.mockResolvedValue({ latitude: 1, longitude: 2 });
    const onShare = vi.fn();
    const onCancel = vi.fn();
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={onCancel}
        onShare={onShare}
      />,
    );
    await waitForShareEnabled();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onShare).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("a denied permission shows the message rather than the coordinates", async () => {
    mockGetCurrentLocation.mockRejectedValue(
      new GeolocationPermissionDeniedError(),
    );
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={vi.fn()}
      />,
    );

    expect(await screen.findByText(/denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i })).toBeDisabled();
  });
});
