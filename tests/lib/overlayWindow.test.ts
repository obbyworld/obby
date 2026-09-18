import { afterEach, describe, expect, test } from "vitest";
import {
  markOverlayDocument,
  overlayKind,
  overlayMonitor,
} from "../../src/lib/overlayWindow";

afterEach(() => {
  document.documentElement.classList.remove("overlay-window");
});

describe("overlayKind", () => {
  test("recognises the picker and the marker", () => {
    expect(overlayKind("?overlay=region&monitor=2")).toBe("region");
    expect(overlayKind("?overlay=marker")).toBe("marker");
  });

  test("an ordinary app window is not an overlay", () => {
    expect(overlayKind("")).toBeNull();
    expect(overlayKind("?lang=de")).toBeNull();
    expect(overlayKind("?overlay=something-else")).toBeNull();
  });
});

describe("overlayMonitor", () => {
  test("reads the screen the window was opened for", () => {
    expect(overlayMonitor("?overlay=region&monitor=3")).toBe(3);
  });

  test("falls back to the first screen when it is missing or nonsense", () => {
    expect(overlayMonitor("?overlay=region")).toBe(0);
    expect(overlayMonitor("?overlay=region&monitor=abc")).toBe(0);
    expect(overlayMonitor("?overlay=region&monitor=-1")).toBe(0);
  });
});

// The window is see-through, but the page paints its own background over it
// unless it is told not to, which is what made the first attempt opaque.
test("an overlay document is marked so its background stays transparent", () => {
  markOverlayDocument();
  expect(document.documentElement.classList.contains("overlay-window")).toBe(
    true,
  );
});
