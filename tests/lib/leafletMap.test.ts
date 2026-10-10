import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { stopTouchOutsideMap } from "../../src/lib/leafletMap";

function touchOn(target: Element) {
  const stopPropagation = vi.fn();
  stopTouchOutsideMap({
    target,
    stopPropagation,
  } as unknown as React.TouchEvent);
  return stopPropagation;
}

describe("stopTouchOutsideMap", () => {
  it("stops a touch outside a map", () => {
    expect(touchOn(document.createElement("button"))).toHaveBeenCalled();
  });

  it("lets a touch on a map reach the document", () => {
    const map = document.createElement("div");
    map.className = "leaflet-container";
    const tile = document.createElement("img");
    map.append(tile);
    expect(touchOn(tile)).not.toHaveBeenCalled();
  });
});
