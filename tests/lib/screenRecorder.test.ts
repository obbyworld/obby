import { beforeEach, describe, expect, test, vi } from "vitest";

const monitors = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: () => Promise.resolve(monitors.value),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  decodeRecording,
  desktopRectFor,
  monitorCropFor,
} from "../../src/lib/screenRecorder";

function monitor(
  x: number,
  y: number,
  width: number,
  height: number,
  scaleFactor: number,
) {
  return { position: { x, y }, size: { width, height }, scaleFactor };
}

beforeEach(() => {
  monitors.value = [];
});

describe("desktopRectFor", () => {
  test("places the rectangle on the primary screen", async () => {
    monitors.value = [monitor(0, 0, 1000, 800, 1)];

    const rect = await desktopRectFor({
      monitor: 0,
      region: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
    });

    expect(rect).toEqual({ x: 250, y: 400, width: 500, height: 200 });
  });

  // A recorder wants points, while a monitor reports pixels, so a Retina
  // screen would otherwise record at twice the offset it was asked for.
  test("a retina screen gives the same place as a standard one", async () => {
    const region = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
    monitors.value = [monitor(0, 0, 1000, 800, 1)];
    const standard = await desktopRectFor({ monitor: 0, region });
    monitors.value = [monitor(0, 0, 2000, 1600, 2)];
    const retina = await desktopRectFor({ monitor: 0, region });

    expect(retina).toEqual(standard);
  });

  test("a rectangle on a second screen keeps that screen's offset", async () => {
    monitors.value = [
      monitor(0, 0, 1000, 800, 1),
      monitor(1000, 0, 1600, 1200, 2),
    ];

    const rect = await desktopRectFor({
      monitor: 1,
      region: { x: 0.5, y: 0, width: 0.25, height: 0.5 },
    });

    // The second screen starts at 500 points across, being 1600 pixels at 2x.
    expect(rect).toEqual({ x: 900, y: 0, width: 200, height: 300 });
  });

  test("a screen that has been unplugged yields nothing to record", async () => {
    monitors.value = [monitor(0, 0, 1000, 800, 1)];

    expect(
      await desktopRectFor({
        monitor: 3,
        region: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBeNull();
  });
});

describe("monitorCropFor", () => {
  // A captured frame holds one screen at its real resolution, so a crop out of
  // it counts pixels from that screen's own corner.
  test("a second screen crops from its own corner, in pixels", async () => {
    monitors.value = [
      monitor(0, 0, 1000, 800, 1),
      monitor(1000, 0, 1600, 1200, 2),
    ];

    const crop = await monitorCropFor({
      monitor: 1,
      region: { x: 0.5, y: 0, width: 0.25, height: 0.5 },
    });

    expect(crop).toEqual({ x: 800, y: 0, width: 400, height: 600 });
  });

  test("a screen that has been unplugged yields nothing to crop", async () => {
    monitors.value = [monitor(0, 0, 1000, 800, 1)];

    expect(
      await monitorCropFor({
        monitor: 3,
        region: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBeNull();
  });
});

describe("decodeRecording", () => {
  // The filehost identifies an upload by its first bytes and refuses one whose
  // content does not match its extension, so the header has to survive intact.
  test("restores a QuickTime header byte for byte", () => {
    const bytes = decodeRecording("AAAAFGZ0eXBxdCAg");
    expect(Array.from(bytes)).toEqual([
      0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    ]);
  });

  test("handles every padding length", () => {
    expect(new TextDecoder().decode(decodeRecording("YQ=="))).toBe("a");
    expect(new TextDecoder().decode(decodeRecording("YWI="))).toBe("ab");
    expect(new TextDecoder().decode(decodeRecording("YWJj"))).toBe("abc");
    expect(decodeRecording("").length).toBe(0);
  });
});
