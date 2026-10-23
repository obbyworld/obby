// Slippy-map tile math shared by the location preview card. Pure and
// network-free so the geometry is unit-testable without a real tile fetch.

const TILE_SIZE = 256;

// Single source of truth for the trusted tile host -- the static preview card
// and the interactive Leaflet map both draw from this template.
export const TILE_URL_TEMPLATE =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const tileUrl = (z: number, x: number, y: number): string =>
  TILE_URL_TEMPLATE.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

export interface TilePlacement {
  x: number;
  y: number;
  z: number;
  drawX: number;
  drawY: number;
}

export function worldPixel(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom * TILE_SIZE;
  const x = ((longitude + 180) / 360) * scale;
  const latRad = (latitude * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    scale;
  return { x, y };
}

// The tiles needed to cover a `width`x`height` crop centred on the position --
// almost always four, never more than the tile grid itself at very low zoom.
export function tilesForPreview(
  latitude: number,
  longitude: number,
  zoom: number,
  width: number,
  height: number = width,
): TilePlacement[] {
  const center = worldPixel(latitude, longitude, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const firstX = Math.floor(left / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastX = Math.floor((left + width - 1) / TILE_SIZE);
  const lastY = Math.floor((top + height - 1) / TILE_SIZE);
  const tileCount = 2 ** zoom;

  const placements: TilePlacement[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = firstX; tx <= lastX; tx++) {
      placements.push({
        x: ((tx % tileCount) + tileCount) % tileCount,
        y: ty,
        z: zoom,
        drawX: Math.round(tx * TILE_SIZE - left),
        drawY: Math.round(ty * TILE_SIZE - top),
      });
    }
  }
  return placements;
}
