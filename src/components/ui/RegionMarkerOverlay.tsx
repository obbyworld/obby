/** The window is the recorded rectangle grown by the width of the frame, so
 *  drawing the frame on the edge leaves the middle, which is what is being
 *  recorded, free of it. */
export function RegionMarkerOverlay() {
  return (
    <div
      data-testid="region-marker"
      className="pointer-events-none fixed inset-0 border-[3px] border-red-500"
      style={{ background: "transparent" }}
    />
  );
}

export default RegionMarkerOverlay;
