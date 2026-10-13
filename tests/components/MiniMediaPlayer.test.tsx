import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { MiniMediaPlayer } from "../../src/components/ui/MiniMediaPlayer";

type ActiveMedia = {
  url: string;
  type: "video" | "audio" | "embed";
  thumbnailUrl?: string;
  isPlaying: boolean;
  isInlineVisible: boolean;
  currentTime?: number;
} | null;

const mockState = {
  ui: {
    activeMedia: null as ActiveMedia,
    openedMedia: null as { url: string } | null,
  },
  playMedia: vi.fn(),
  pauseActiveMedia: vi.fn(),
  stopActiveMedia: vi.fn(),
};

vi.mock("../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) =>
      typeof selector === "function" ? selector(mockState) : null,
    ),
    { getState: () => mockState },
  ),
}));

vi.mock("../../src/lib/mediaUtils", () => ({
  getEmbedThumbnailUrl: vi.fn(() => null),
  getEmbedFallbackLabel: vi.fn((url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return "embed";
    }
  }),
  filenameFromUrl: vi.fn((url: string) => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    } catch {
      return "";
    }
  }),
}));

// jsdom doesn't implement HTMLMediaElement methods
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});

// Fake audio element: always reports as playing so the loading-state effect
// short-circuits and the Pause/Play buttons remain visible in tests.
const fakeAudio = {
  src: "",
  paused: false,
  currentTime: 0,
  duration: Number.NaN,
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
vi.mock("../../src/lib/audioManager", () => ({
  getAudio: () => fakeAudio,
}));

beforeEach(() => {
  mockState.ui.activeMedia = null;
  mockState.ui.openedMedia = null;
  mockState.playMedia.mockReset();
  mockState.pauseActiveMedia.mockReset();
  mockState.stopActiveMedia.mockReset();
});

describe("MiniMediaPlayer", () => {
  test("returns null when activeMedia is null", () => {
    const { container } = render(<MiniMediaPlayer />);
    expect(container.firstChild).toBeNull();
  });

  test("returns null when openedMedia is not null (modal open)", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/a.mp3",
      type: "audio",
      isPlaying: true,
      isInlineVisible: true,
    };
    mockState.ui.openedMedia = { url: "https://example.com/a.mp3" };
    const { container } = render(<MiniMediaPlayer />);
    expect(container.firstChild).toBeNull();
  });

  test("renders bar when activeMedia is set", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/song.mp3",
      type: "audio",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { container } = render(<MiniMediaPlayer />);
    expect(container.firstChild).not.toBeNull();
  });

  test("audio: play and stop buttons are present", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/song.mp3",
      type: "audio",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { getByLabelText } = render(<MiniMediaPlayer />);
    expect(getByLabelText("Pause")).toBeTruthy();
    expect(getByLabelText("Stop")).toBeTruthy();
  });

  test("audio: play button shown when not playing", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/song.mp3",
      type: "audio",
      isPlaying: false,
      isInlineVisible: true,
    };
    const { getByLabelText } = render(<MiniMediaPlayer />);
    expect(getByLabelText("Play")).toBeTruthy();
  });

  test("stop button calls stopActiveMedia", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/song.mp3",
      type: "audio",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { getByLabelText } = render(<MiniMediaPlayer />);
    fireEvent.click(getByLabelText("Stop"));
    expect(mockState.stopActiveMedia).toHaveBeenCalledOnce();
  });

  test("video + isInlineVisible: true → shows filename and pre-loaded hidden <video>", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/clip.mp4",
      type: "video",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { getByText, container } = render(<MiniMediaPlayer />);
    expect(getByText("clip.mp4")).toBeTruthy();
    // Hidden video is always rendered for pre-loading; drive effect pauses it while inline visible.
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("video")?.getAttribute("preload")).toBe(
      "metadata",
    );
  });

  test("video: falls back to 'Now Playing' when filename cannot be extracted", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/",
      type: "video",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { getByText } = render(<MiniMediaPlayer />);
    expect(getByText("Now Playing")).toBeTruthy();
  });

  test("video + isInlineVisible: false → shows hidden <video> element", () => {
    mockState.ui.activeMedia = {
      url: "https://example.com/clip.mp4",
      type: "video",
      isPlaying: true,
      isInlineVisible: false,
    };
    const { container } = render(<MiniMediaPlayer />);
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/clip.mp4",
    );
  });

  test("embed type: renders stop button, no video element", () => {
    mockState.ui.activeMedia = {
      url: "https://youtube.com/watch?v=abc",
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { getByLabelText, container } = render(<MiniMediaPlayer />);
    expect(getByLabelText("Stop")).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
  });
});
