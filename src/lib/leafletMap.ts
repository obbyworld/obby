export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 19;

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Classic teardrop map pin, matching the marker drawn on the static preview
// card. A plain SVG string so the Leaflet layer needs no React.
export const MAP_PIN_SVG = `<svg width="28" height="40" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24c0-6.627-5.373-12-12-12z" fill="#dc2626"/>
  <circle cx="12" cy="12" r="5" fill="#fff"/>
</svg>`;

export function clampMapZoom(zoom: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom));
}

let leafletPromise: Promise<typeof import("leaflet")> | null = null;

/** Leaflet and its CSS, fetched the first time a map is actually opened so
 *  nothing map-related ships in the main bundle. */
export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([
      import("leaflet"),
      import("leaflet/dist/leaflet.css"),
    ]).then(([mod]) => mod);
  }
  return leafletPromise;
}
