import { describe, expect, it } from "vitest";
import { tilesForPreview, tileUrl, worldPixel } from "../../src/lib/osmTiles";

describe("tileUrl", () => {
  it("builds the standard OpenStreetMap tile path", () => {
    expect(tileUrl(14, 4823, 6160)).toBe(
      "https://tile.openstreetmap.org/14/4823/6160.png",
    );
  });
});

describe("worldPixel", () => {
  it("places the prime meridian and equator at the centre of the world map", () => {
    const zoom = 4;
    const { x, y } = worldPixel(0, 0, zoom);
    const worldSize = 256 * 2 ** zoom;
    expect(x).toBeCloseTo(worldSize / 2, 5);
    expect(y).toBeCloseTo(worldSize / 2, 5);
  });
});

describe("tilesForPreview", () => {
  it("returns between one and four tiles for a normal preview window", () => {
    const placements = tilesForPreview(40.7128, -74.006, 14, 256);
    expect(placements.length).toBeGreaterThanOrEqual(1);
    expect(placements.length).toBeLessThanOrEqual(4);
  });

  it("keeps every tile index inside the zoom level's grid", () => {
    const zoom = 5;
    const tileCount = 2 ** zoom;
    for (const placement of tilesForPreview(51.5, -0.12, zoom, 256)) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x).toBeLessThan(tileCount);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeLessThan(tileCount);
    }
  });

  it("wraps the tile column across the antimeridian instead of going out of range", () => {
    const zoom = 3;
    const tileCount = 2 ** zoom;
    for (const placement of tilesForPreview(0, 179.999, zoom, 256)) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x).toBeLessThan(tileCount);
    }
  });
});
