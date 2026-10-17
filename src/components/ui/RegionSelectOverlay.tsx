import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import {
  cancelRegionSelection,
  MIN_REGION_FRACTION,
  publishRegionSelection,
} from "../../lib/screenRegion";

interface Point {
  x: number;
  y: number;
}

function rectBetween(a: Point, b: Point) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** The page shown by the transparent window that covers one monitor. The
 *  rectangle is reported as fractions of this window, which is exactly the
 *  monitor, so nothing downstream has to know about screen scaling. */
export function RegionSelectOverlay({ monitor }: { monitor: number }) {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void cancelRegionSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const finish = (from: Point, to: Point) => {
    if (sentRef.current) return;
    const rect = rectBetween(from, to);
    const region = {
      x: rect.left / window.innerWidth,
      y: rect.top / window.innerHeight,
      width: rect.width / window.innerWidth,
      height: rect.height / window.innerHeight,
    };
    if (
      region.width < MIN_REGION_FRACTION ||
      region.height < MIN_REGION_FRACTION
    ) {
      void cancelRegionSelection();
      return;
    }
    sentRef.current = true;
    void publishRegionSelection({ monitor, region });
  };

  const box = start && current ? rectBetween(start, current) : null;

  return (
    <div
      data-testid="region-overlay"
      className="fixed inset-0 cursor-crosshair select-none"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => {
        setStart({ x: e.clientX, y: e.clientY });
        setCurrent({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={(e) => {
        if (start) setCurrent({ x: e.clientX, y: e.clientY });
      }}
      onMouseUp={(e) => {
        if (start) finish(start, { x: e.clientX, y: e.clientY });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        void cancelRegionSelection();
      }}
    >
      {box && (
        <div
          data-testid="region-box"
          className="absolute border-2 border-discord-primary"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            // Punching the dimming back out is what makes the selection read
            // as a hole cut in the screen rather than a box drawn on it.
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
            background: "transparent",
          }}
        />
      )}
      {!box && (
        // Whatever is on the desktop shows through behind this, so the words
        // need a ground of their own to stay readable over anything.
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <p className="rounded-lg bg-black/85 px-5 py-3 text-sm text-white shadow-xl ring-1 ring-white/25">
            <Trans>
              Drag to choose what to record. Press Escape to cancel.
            </Trans>
          </p>
        </div>
      )}
      {/* A window covering every screen has to carry its own way out, since a
          window that never took focus gets no key presses. */}
      <button
        type="button"
        onMouseDown={(e) => {
          e.stopPropagation();
          void cancelRegionSelection();
        }}
        className="absolute right-4 top-4 min-h-11 rounded bg-black/70 px-4 text-sm text-white hover:bg-black/90"
      >
        <Trans>Cancel</Trans>
      </button>
    </div>
  );
}

export default RegionSelectOverlay;
