import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { MediaPreview } from "../../src/components/message/MediaPreview";
import type { MediaEntry } from "../../src/lib/mediaUtils";
import { setVideoPosition } from "../../src/lib/videoPositionCache";

type ActiveMedia = {
  url: string;
  type: string;
  isPlaying: boolean;
  isInlineVisible: boolean;
} | null;

const mockState = {
  ui: {
    activeMedia: null as ActiveMedia,
    openedMedia: null as { url: string } | null,
  },
  openMedia: vi.fn(),
  playMedia: vi.fn(),
  pauseActiveMedia: vi.fn(),
  stopActiveMedia: vi.fn(),
  setMediaInlineVisible: vi.fn(),
  setActiveMediaThumbnail: vi.fn(),
};

vi.mock("../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) =>
      typeof selector === "function" ? selector(mockState) : null,
    ),
    { getState: () => mockState },
  ),
}));

vi.mock("../../src/lib/ircClient", () => ({
  default: { getCurrentUser: vi.fn(() => null) },
}));

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pdf-document">{children}</div>
  ),
  Page: () => <div data-testid="pdf-page" />,
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

vi.mock("react-player", () => ({
  default: ({
    src,
    playing,
    config,
  }: {
    src: string;
    playing?: boolean;
    config?: { youtube?: { start?: number } };
  }) => (
    <div
      data-testid="react-player"
      data-src={src}
      data-playing={String(playing)}
      data-start={String(config?.youtube?.start)}
    />
  ),
}));

vi.mock("exifr", () => ({ default: { parse: vi.fn(() => null) } }));

const EMBED_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("MediaPreview", () => {
  beforeEach(() => {
    mockState.ui.activeMedia = null;
    mockState.ui.openedMedia = null;
  });

  const makeEntry = (
    type: MediaEntry["type"],
    url = "https://example.com/media",
  ): MediaEntry => ({
    url,
    type,
  });

  test("renders img for image entry", () => {
    const { container } = render(
      <MediaPreview
        entry={makeEntry("image", "https://example.com/photo.jpg")}
      />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
  });

  // A lazy image that is not rendered never loads, so `onLoad` never arrives
  // and the image stays invisible forever. It must be hidden with opacity
  // while it loads, never with `display: none`.
  test("a loading image is lazy but still rendered", () => {
    const { container } = render(
      <MediaPreview
        entry={makeEntry("image", "https://example.com/photo.jpg")}
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.className).not.toContain("hidden");
    expect(img?.className).toContain("opacity-0");
  });

  test("renders video for video entry", () => {
    const { container } = render(
      <MediaPreview
        entry={makeEntry("video", "https://example.com/video.mp4")}
      />,
    );
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.src).toContain("video.mp4");
  });

  test("video uses preload=metadata", () => {
    const { container } = render(
      <MediaPreview
        entry={makeEntry("video", "https://example.com/video.mp4")}
      />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("preload")).toBe("metadata");
  });

  test("a video file with no picture plays as audio", async () => {
    const { container } = render(
      <MediaPreview
        entry={makeEntry("video", "https://example.com/voice-message.webm")}
      />,
    );
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    fireEvent(video as HTMLVideoElement, new Event("loadedmetadata"));

    await waitFor(() => expect(container.querySelector("video")).toBeNull());
  });

  test("audio entry renders play button, not audio element", () => {
    const { container, getByLabelText } = render(
      <MediaPreview
        entry={makeEntry("audio", "https://example.com/audio.mp3")}
      />,
    );
    // No audio element — dispatch-only control
    expect(container.querySelector("audio")).toBeNull();
    // Play button should be present
    expect(getByLabelText("Play")).toBeTruthy();
  });

  test("a non-filehost image that fails to load reports onRenderFailed and renders nothing", async () => {
    const onRenderFailed = vi.fn();
    const url = "https://example.com/photo.jpg";
    const { container } = render(
      <MediaPreview
        entry={makeEntry("image", url)}
        onRenderFailed={onRenderFailed}
      />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: asserted truthy above
    fireEvent.error(img!);

    await waitFor(() => expect(onRenderFailed).toHaveBeenCalledWith(url));
    expect(container.querySelector("img")).toBeNull();
  });

  test("a working image never reports onRenderFailed", () => {
    const onRenderFailed = vi.fn();
    render(
      <MediaPreview
        entry={makeEntry("image", "https://example.com/photo.jpg")}
        onRenderFailed={onRenderFailed}
      />,
    );
    expect(onRenderFailed).not.toHaveBeenCalled();
  });
});

describe("EmbedPreview — Now Playing Bar stop behaviour", () => {
  beforeEach(() => {
    mockState.ui.activeMedia = null;
    mockState.ui.openedMedia = null;
  });

  const embedEntry = (): MediaEntry => ({ url: EMBED_URL, type: "embed" });

  // A provider iframe is the most expensive thing a message can mount, so an
  // idle embed must stay a thumbnail until someone asks for playback.
  test("no player until the embed is activated", () => {
    const { queryByTestId, getByLabelText } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    expect(queryByTestId("react-player")).toBeNull();
    expect(getByLabelText("Play")).toBeTruthy();
  });

  test("pressing the thumbnail starts playback", async () => {
    mockState.playMedia.mockClear();
    const { findByTestId, getByLabelText } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    fireEvent.click(getByLabelText("Play"));
    await findByTestId("react-player");
    expect(mockState.playMedia).toHaveBeenCalledWith(
      EMBED_URL,
      "embed",
      expect.anything(),
      undefined,
      undefined,
      undefined,
    );
  });

  // ReactPlayer is lazy-loaded; findByTestId waits for Suspense to resolve.
  test("playing=undefined when no active media — iframe is uncontrolled", async () => {
    const { findByTestId, getByLabelText } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    fireEvent.click(getByLabelText("Play"));
    const player = await findByTestId("react-player");
    // undefined = don't interfere; user can click play inside YouTube natively.
    // Passing false would force-pause the iframe and break playback initiation.
    expect(player.dataset.playing).toBe("undefined");
  });

  test("playing=true when this embed is active and playing", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { findByTestId } = render(<MediaPreview entry={embedEntry()} />);
    const player = await findByTestId("react-player");
    expect(player.dataset.playing).toBe("true");
  });

  test("playing=false when active but paused", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: false,
      isInlineVisible: true,
    };
    const { findByTestId } = render(<MediaPreview entry={embedEntry()} />);
    const player = await findByTestId("react-player");
    expect(player.dataset.playing).toBe("false");
  });

  test("playing=false when media viewer modal is open", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    mockState.ui.openedMedia = { url: EMBED_URL };
    const { findByTestId } = render(<MediaPreview entry={embedEntry()} />);
    const player = await findByTestId("react-player");
    expect(player.dataset.playing).toBe("false");
  });

  test("ReactPlayer remounts when stopped — embed resets to beginning", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { findByTestId, rerender } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    const nodeBeforeStop = await findByTestId("react-player");

    // Simulate user clicking Stop in the Now Playing Bar
    mockState.ui.activeMedia = null;
    rerender(<MediaPreview entry={embedEntry()} />);

    // A new DOM node means ReactPlayer was remounted (playerKey incremented).
    // Without the remount, the embed stays paused mid-video instead of resetting.
    const nodeAfterStop = await findByTestId("react-player");
    expect(nodeAfterStop).not.toBe(nodeBeforeStop);
  });

  test("playing=undefined after stop — remounted iframe is uncontrolled again", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    const { findByTestId, rerender } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    await findByTestId("react-player");

    mockState.ui.activeMedia = null;
    rerender(<MediaPreview entry={embedEntry()} />);

    const player = await findByTestId("react-player");
    expect(player.dataset.playing).toBe("undefined");
  });

  // YouTube starts playing whenever it seeks an unstarted video, so a stopped
  // embed that resumed mid-video would take playback back from the new one.
  test("an embed another one takes over from restarts at the beginning", async () => {
    mockState.ui.activeMedia = {
      url: EMBED_URL,
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    setVideoPosition(EMBED_URL, 16);
    const { findByTestId, rerender } = render(
      <MediaPreview entry={embedEntry()} />,
    );
    const playing = await findByTestId("react-player");
    expect(playing.dataset.start).toBe("16");

    mockState.ui.activeMedia = {
      url: "https://www.youtube.com/watch?v=wmin5WkOuPw",
      type: "embed",
      isPlaying: true,
      isInlineVisible: true,
    };
    rerender(<MediaPreview entry={embedEntry()} />);

    await waitFor(async () =>
      expect(await findByTestId("react-player")).not.toBe(playing),
    );
    expect((await findByTestId("react-player")).dataset.start).toBe("0");
  });
});
