import "@testing-library/jest-dom";
import { i18n } from "@lingui/core";
import { vi } from "vitest";

// Initialize lingui with empty English catalog so t`` and Trans just pass strings through
i18n.load("en", {});
i18n.activate("en");

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.scrollTo = vi.fn();
// jsdom returns "" for all canPlayType queries, making every video look unsupported.
// Return "probably" so tests exercise the normal player path.
window.HTMLVideoElement.prototype.canPlayType = vi.fn(
  () => "probably" as CanPlayTypeResult,
);
// A plain function so a test's vi.spyOn replaces it: useMediaQuery caches its
// lists until window.matchMedia itself changes.
window.matchMedia = ((query: string) => ({
  media: query,
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as (query: string) => MediaQueryList;

// jsdom never focuses its window, and tests play a user at the screen.
document.hasFocus = () => true;

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// jsdom implements no MediaStream, and every live preview goes through
// VideoTrackView, which constructs one to hand a track to a video element.
class MediaStreamStub {
  private readonly tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

if (typeof globalThis.MediaStream === "undefined") {
  vi.stubGlobal("MediaStream", MediaStreamStub);
}

// jsdom's HTMLMediaElement.play returns undefined where a browser returns a
// promise, so every caller that awaits it would throw.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn(() => Promise.resolve()),
});
