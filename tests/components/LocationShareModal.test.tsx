import {
  act,
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

const leaflet = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {};
  const instance = {
    on: (event: string, callback: () => void) => {
      handlers[event] = callback;
    },
    getCenter: vi.fn(() => ({ lat: 48.8, lng: 2.3 })),
    getZoom: vi.fn(() => 16),
    setView: vi.fn(),
    setZoom: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  };
  return {
    handlers,
    instance,
    mapSpy: vi.fn(
      (
        _el: HTMLElement,
        _options: { center: [number, number]; zoom: number },
      ) => instance,
    ),
    tileLayerSpy: vi.fn(() => ({ addTo: vi.fn() })),
  };
});

vi.mock("leaflet", () => ({
  map: leaflet.mapSpy,
  tileLayer: leaflet.tileLayerSpy,
}));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

/** The map reports its centre only once it settles, so a drag is that event. */
async function dragMapToCentre() {
  await waitFor(() => expect(leaflet.mapSpy).toHaveBeenCalled());
  act(() => leaflet.handlers.moveend?.());
}

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

  it("opens the map on the device position", async () => {
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

    await waitFor(() => expect(leaflet.mapSpy).toHaveBeenCalled());
    const options = leaflet.mapSpy.mock.calls[0][1];
    expect(options.center).toEqual([40.7127837, -74.0059413]);
    expect(options.zoom).toBe(14);
  });

  it("shares the place the map was dragged to", async () => {
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
    await dragMapToCentre();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(onShare).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=48.8&mlon=2.3#map=16/48.8/2.3",
    );
  });

  it("rounds the dragged pin when the position stays approximate", async () => {
    mockGetCurrentLocation.mockResolvedValue({ latitude: 1, longitude: 2 });
    const onShare = vi.fn();
    leaflet.instance.getCenter.mockReturnValueOnce({
      lat: 48.85837,
      lng: 2.29448,
    });
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={onShare}
      />,
    );
    await waitForShareEnabled();
    await dragMapToCentre();

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(onShare).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=48.858&mlon=2.294#map=16/48.858/2.294",
    );
  });

  // Pressing a precision is how someone gets back after wandering off, so it
  // returns to their own position every time, including the one already on.
  it("puts the map back on the device position on every precision press", async () => {
    mockGetCurrentLocation.mockResolvedValue({ latitude: 1, longitude: 2 });
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={vi.fn()}
      />,
    );
    await waitForShareEnabled();
    await dragMapToCentre();

    fireEvent.click(screen.getByRole("button", { name: /^exact$/i }));
    expect(leaflet.instance.setView).toHaveBeenLastCalledWith([1, 2], 17);

    fireEvent.click(screen.getByRole("button", { name: /^exact$/i }));
    expect(leaflet.instance.setView).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /^approximate$/i }));
    expect(leaflet.instance.setView).toHaveBeenLastCalledWith([1, 2], 14);
  });

  it("shares the device position again after a precision press", async () => {
    mockGetCurrentLocation.mockResolvedValue({ latitude: 1, longitude: 2 });
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
    await dragMapToCentre();

    fireEvent.click(screen.getByRole("button", { name: /^exact$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(onShare).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=1&mlon=2#map=17/1/2",
    );
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
    expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
  });

  it("asks for the location again from the error", async () => {
    mockGetCurrentLocation
      .mockRejectedValueOnce(new GeolocationPermissionDeniedError())
      .mockResolvedValueOnce({ latitude: 52.21, longitude: 7.18 });
    render(
      <LocationShareModal
        isOpen
        target="alice"
        onCancel={vi.fn()}
        onShare={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    await waitForShareEnabled();
    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(2);
  });
});
