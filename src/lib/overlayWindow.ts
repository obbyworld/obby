export type OverlayKind = "region" | "marker" | "recording";

/** Which bare window this document is, if any. The desktop app loads the same
 *  bundle for all of them. */
export function overlayKind(
  search: string = window.location.search,
): OverlayKind | null {
  const value = new URLSearchParams(search).get("overlay");
  return value === "region" || value === "marker" || value === "recording"
    ? value
    : null;
}

export function overlayMonitor(
  search: string = window.location.search,
): number {
  const raw = Number(new URLSearchParams(search).get("monitor"));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/** Marks the document so its background stays see-through. Set before the
 *  first paint, or the overlay flashes opaque over the desktop. */
export function markOverlayDocument(): void {
  document.documentElement.classList.add("overlay-window");
}
