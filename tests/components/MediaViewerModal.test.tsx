import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clampZoom,
  MediaViewerModal,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../src/components/ui/MediaViewerModal";
import * as mediaProbe from "../../src/lib/mediaProbe";
import * as platformUtils from "../../src/lib/platformUtils";
import * as store from "../../src/store";

vi.mock("../../src/lib/openUrl", () => ({
  openExternalUrl: vi.fn(),
}));

// react-pdf uses dynamic import() via React.lazy in MediaViewerModal.
// Mock the module so Document immediately calls onLoadSuccess and Page renders a placeholder.
vi.mock("react-pdf", () => ({
  Document: ({
    onLoadSuccess,
    onLoadError: _onLoadError,
    children,
    loading: _loading,
    file: _file,
  }: {
    onLoadSuccess?: (pdf: { numPages: number }) => void;
    onLoadError?: () => void;
    children?: React.ReactNode;
    loading?: React.ReactNode;
    file?: string;
  }) => {
    // Simulate async PDF load: call onLoadSuccess after mount.
    React.useEffect(() => {
      onLoadSuccess?.({ numPages: 3 });
    }, [onLoadSuccess]);
    return React.createElement(
      "div",
      { "data-testid": "pdf-document" },
      children,
    );
  },
  Page: ({ pageNumber }: { pageNumber: number }) =>
    React.createElement(
      "div",
      { "data-testid": "pdf-page" },
      `Page ${pageNumber}`,
    ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

vi.mock("../../src/lib/platformUtils", () => ({
  isTauri: vi.fn(() => false),
}));

const defaultMessage = {
  id: "1",
  content: "https://example.com/image.jpg",
  serverId: "s1",
  channelId: "c1",
  type: "message",
  timestamp: new Date(),
  userId: "user1",
  reactions: [],
  msgid: "msg1",
};

vi.mock("../../src/store", () => ({
  getChannelMessages: vi.fn(() => [defaultMessage]),
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) =>
      typeof selector === "function"
        ? selector({
            messages: {},
            globalSettings: { mediaVisibilityLevel: 3 },
          })
        : null,
    ),
    { getState: vi.fn(() => ({ messages: {}, servers: [] })) },
  ),
}));

vi.mock("../../src/lib/mediaProbe", () => ({
  probeMediaUrl: vi.fn((_url: string) =>
    Promise.resolve({ type: "image", skipped: false }),
  ),
  getCachedProbeResult: vi.fn((_url: string) => undefined),
}));

vi.mock("../../src/lib/ircClient", () => ({
  default: { sendRaw: vi.fn() },
  ircClient: { sendRaw: vi.fn() },
}));

// ExternalLinkWarningModal → BaseModal → useMediaQuery needs matchMedia
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clampZoom", () => {
  test("clamps to minimum", () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-5)).toBe(ZOOM_MIN);
  });

  test("clamps to maximum", () => {
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
  });

  test("passes through values within range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(clampZoom(ZOOM_MAX)).toBe(ZOOM_MAX);
  });
});

describe("MediaViewerModal", () => {
  const defaultProps = {
    isOpen: true,
    url: "https://example.com/image.jpg",
    onClose: vi.fn(),
    serverId: "s1",
    channelId: "c1",
  };

  test("renders image with correct src", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const img = screen.getByRole("img", { name: "Image preview" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", defaultProps.url);
  });

  test("has zoom in and zoom out buttons", () => {
    render(<MediaViewerModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zoom out" }),
    ).toBeInTheDocument();
  });

  test("zoom in button increases slider value", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const slider = screen.getByRole("slider", { name: "Zoom level" });
    expect(slider).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(slider).toHaveValue("1.25");
  });

  test("zoom out button decreases slider value", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const slider = screen.getByRole("slider", { name: "Zoom level" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(slider).toHaveValue("1");
  });

  test("clicking image toggles between 1x and 2x zoom", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const img = screen.getByRole("img", { name: "Image preview" });
    fireEvent.click(img);
    expect((img as HTMLImageElement).style.transform).toBe(
      "translate(0px, 0px) scale(2) rotate(0deg)",
    );
    fireEvent.click(img);
    expect((img as HTMLImageElement).style.transform).toBe(
      "translate(0px, 0px) scale(1) rotate(0deg)",
    );
  });

  test("dragging when zoomed pans the image", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const img = screen.getByRole("img", { name: "Image preview" });
    const dialog = screen.getByRole("dialog");

    // Zoom in first so drag is enabled
    fireEvent.click(img);

    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(dialog, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(dialog);

    expect((img as HTMLImageElement).style.transform).toBe(
      "translate(50px, 30px) scale(2) rotate(0deg)",
    );
  });

  test("drag does not toggle zoom", () => {
    render(<MediaViewerModal {...defaultProps} />);
    const img = screen.getByRole("img", { name: "Image preview" });
    const dialog = screen.getByRole("dialog");
    const slider = screen.getByRole("slider", { name: "Zoom level" });

    // Zoom to 2x first
    fireEvent.click(img);
    expect(slider).toHaveValue("2");

    // Drag — should not change zoom back to 1
    fireEvent.mouseDown(img, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(img);

    expect(slider).toHaveValue("2");
  });

  test("shows ExternalLinkWarningModal when Open button clicked", () => {
    render(<MediaViewerModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open in browser/i }));
    expect(screen.getByText("External Link Warning")).toBeInTheDocument();
  });

  test("calls onClose when ESC pressed", () => {
    const onClose = vi.fn();
    render(<MediaViewerModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  test("does not render when closed", () => {
    render(<MediaViewerModal {...defaultProps} isOpen={false} />);
    expect(
      screen.queryByRole("img", { name: "Image preview" }),
    ).not.toBeInTheDocument();
  });

  test("download button hidden in browser (non-Tauri)", () => {
    // isTauri() returns false (mocked above)
    render(<MediaViewerModal {...defaultProps} />);
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
  });

  test("download button invokes Rust command on Tauri", async () => {
    vi.mocked(platformUtils.isTauri).mockReturnValue(true);
    const mockInvoke = vi.fn().mockResolvedValue("Saved to Downloads");
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

    render(<MediaViewerModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("download_image", {
        url: defaultProps.url,
      });
    });
  });

  test("comments toggle button not shown without serverId/channelId", () => {
    render(
      <MediaViewerModal
        {...defaultProps}
        serverId={undefined}
        channelId={undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /comments/i }),
    ).not.toBeInTheDocument();
  });

  describe("navigation", () => {
    test("no navigation arrows when no serverId/channelId provided", () => {
      render(
        <MediaViewerModal
          {...defaultProps}
          serverId={undefined}
          channelId={undefined}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /previous image/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /next image/i }),
      ).not.toBeInTheDocument();
    });

    test("shows next arrow when more images exist after current", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue([
        {
          id: "1",
          content: "https://example.com/image.jpg",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
          msgid: "1",
        },
        {
          id: "2",
          content: "https://example.com/image2.png",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
          msgid: "2",
        },
      ] as unknown as ReturnType<typeof store.getChannelMessages>);

      render(
        <MediaViewerModal
          {...defaultProps}
          url="https://example.com/image.jpg"
          serverId="s1"
          channelId="c1"
        />,
      );

      // prev button is rendered but disabled (visually hidden) when on first image
      expect(
        screen.getByRole("button", { name: /previous image/i }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: /next image/i })).toBeEnabled();
    });

    test("keyboard arrow navigation works", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue([
        {
          id: "1",
          content: "https://example.com/image.jpg",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
          msgid: "1",
        },
        {
          id: "2",
          content: "https://example.com/image2.png",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
          msgid: "2",
        },
      ] as unknown as ReturnType<typeof store.getChannelMessages>);

      render(
        <MediaViewerModal
          {...defaultProps}
          url="https://example.com/image.jpg"
          serverId="s1"
          channelId="c1"
        />,
      );

      const img = screen.getByRole("img", { name: "Image preview" });
      expect(img).toHaveAttribute("src", "https://example.com/image.jpg");

      fireEvent.keyDown(document, { key: "ArrowRight" });
      expect(img).toHaveAttribute("src", "https://example.com/image2.png");

      fireEvent.keyDown(document, { key: "ArrowLeft" });
      expect(img).toHaveAttribute("src", "https://example.com/image.jpg");
    });
  });

  describe("duplicate URL handling", () => {
    // Two different messages that both contain the same image URL.
    const duplicateMessages = [
      {
        id: "msg-a",
        msgid: "msgid-a",
        content: "https://example.com/same.jpg",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
      },
      {
        id: "msg-b",
        msgid: "msgid-b",
        content: "https://example.com/same.jpg",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user2",
        reactions: [],
      },
    ] as unknown as ReturnType<typeof store.getChannelMessages>;

    test("opening the second duplicate selects the second filmstrip entry", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue(duplicateMessages);

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/same.jpg"
          sourceMsgId="msgid-b"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      // The filmstrip should show two thumbnails (same URL, two separate entries).
      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 2/i });
      expect(thumbs).toHaveLength(2);

      // The SECOND thumbnail must be the active one (aria-current="true").
      expect(thumbs[0]).not.toHaveAttribute("aria-current", "true");
      expect(thumbs[1]).toHaveAttribute("aria-current", "true");
    });

    test("opening the first duplicate selects the first filmstrip entry", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue(duplicateMessages);

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/same.jpg"
          sourceMsgId="msgid-a"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 2/i });
      expect(thumbs[0]).toHaveAttribute("aria-current", "true");
      expect(thumbs[1]).not.toHaveAttribute("aria-current", "true");
    });

    test("arrow navigation moves one entry at a time through duplicates", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue(duplicateMessages);

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/same.jpg"
          sourceMsgId="msgid-a"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 2/i });
      // Start at entry 0.
      expect(thumbs[0]).toHaveAttribute("aria-current", "true");

      // ArrowRight should advance to entry 1 (second duplicate).
      fireEvent.keyDown(document, { key: "ArrowRight" });
      expect(thumbs[1]).toHaveAttribute("aria-current", "true");
      expect(thumbs[0]).not.toHaveAttribute("aria-current", "true");

      // ArrowLeft should go back to entry 0.
      fireEvent.keyDown(document, { key: "ArrowLeft" });
      expect(thumbs[0]).toHaveAttribute("aria-current", "true");
    });

    test("message with multiple images creates one entry per image", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue([
        {
          id: "msg-multi",
          msgid: "msgid-multi",
          content:
            "check these out https://example.com/a.jpg and https://example.com/b.png",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
        },
      ] as unknown as ReturnType<typeof store.getChannelMessages>);

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/a.jpg"
          sourceMsgId="msgid-multi"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      // Both images from the single message appear as separate filmstrip entries.
      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 2/i });
      expect(thumbs).toHaveLength(2);
      expect(thumbs[0]).toHaveAttribute("aria-current", "true");

      // Arrow right navigates to the second image in the same message.
      const img = screen.getByRole("img", { name: "Image preview" });
      fireEvent.keyDown(document, { key: "ArrowRight" });
      expect(img).toHaveAttribute("src", "https://example.com/b.png");
      expect(thumbs[1]).toHaveAttribute("aria-current", "true");
    });

    test("PDF viewer shows page navigation after document loads", async () => {
      vi.mocked(store.getChannelMessages).mockReturnValue([
        {
          id: "pdf-msg",
          msgid: "pdf-msgid",
          content: "https://example.com/doc.pdf",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
        },
      ] as unknown as ReturnType<typeof store.getChannelMessages>);

      const { probeMediaUrl, getCachedProbeResult } = await import(
        "../../src/lib/mediaProbe"
      );
      vi.mocked(getCachedProbeResult).mockReturnValue({
        type: "pdf",
        streamable: false,
        skipped: false,
      });
      vi.mocked(probeMediaUrl).mockResolvedValue({
        type: "pdf",
        streamable: false,
        skipped: false,
      });

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/doc.pdf"
          sourceMsgId="pdf-msgid"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      // Page navigation must appear once the PDF document loads.
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Previous page" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Next page" }),
        ).toBeInTheDocument();
        expect(screen.getByText("1 / 3")).toBeInTheDocument();
      });

      // Previous is disabled on first page; Next is enabled.
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

      // Clicking Next advances to page 2.
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toBeEnabled();

      // Clicking Next again advances to page 3 (last page).
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByText("3 / 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    test("same URL in multi-image message and another message are distinct entries", () => {
      vi.mocked(store.getChannelMessages).mockReturnValue([
        {
          id: "msg-1",
          msgid: "msgid-1",
          content:
            "https://example.com/same.jpg and https://example.com/other.png",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user1",
          reactions: [],
        },
        {
          id: "msg-2",
          msgid: "msgid-2",
          content: "https://example.com/same.jpg",
          serverId: "s1",
          channelId: "c1",
          type: "message",
          timestamp: new Date(),
          userId: "user2",
          reactions: [],
        },
      ] as unknown as ReturnType<typeof store.getChannelMessages>);

      render(
        <MediaViewerModal
          isOpen={true}
          url="https://example.com/same.jpg"
          sourceMsgId="msgid-2"
          onClose={vi.fn()}
          serverId="s1"
          channelId="c1"
        />,
      );

      // 3 entries total: same.jpg(msg-1), other.png(msg-1), same.jpg(msg-2)
      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 3/i });
      expect(thumbs).toHaveLength(3);

      // sourceMsgId="msgid-2" means the third entry (index 2) is active.
      expect(thumbs[2]).toHaveAttribute("aria-current", "true");
      expect(thumbs[0]).not.toHaveAttribute("aria-current", "true");
    });
  });
});

describe("filehost URL filtering", () => {
  test("filehost HTML/paste URLs cached as non-media are excluded from the filmstrip", async () => {
    // Three messages: two real images (.jpg extension) plus one message containing
    // a paste page URL and an HTML page URL from the same filehost.
    // getCachedProbeResult returns { type: null, skipped: false } for the non-media
    // URLs, simulating a previous probe that confirmed they are not media.
    // After the map e.type stays null for those; getCachedProbeResult returns a
    // non-undefined object → condition 3 (isUrlFromFilehost) must be false → excluded.
    // Result: only the two .jpg images appear (2 of 2, not 2+2 of 4).
    // getCachedProbeResult returns null (not undefined) to signal confirmed non-media.
    vi.mocked(mediaProbe.getCachedProbeResult).mockImplementation((url) => {
      if (url.includes("/p") || url.endsWith(".html")) {
        return null;
      }
      return undefined;
    });

    vi.mocked(store.getChannelMessages).mockReturnValueOnce([
      {
        id: "1",
        content: "https://files.example.com/GDv.jpg",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
        msgid: "msg1",
      },
      {
        id: "2",
        content:
          "https://files.example.com/GDq/p - Try online: https://files.example.com/GDq.html",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
        msgid: "msg2",
      },
      {
        id: "3",
        content: "https://files.example.com/GDw.jpg",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
        msgid: "msg3",
      },
    ] as unknown as ReturnType<typeof store.getChannelMessages>);

    const getStateFn = (
      store.default as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState;
    getStateFn.mockReturnValueOnce({
      messages: {},
      servers: [
        {
          id: "s1",
          filehost: "files.example.com",
          channels: [{ id: "c1", topic: null }],
        },
      ],
    });

    render(
      <MediaViewerModal
        isOpen={true}
        url="https://files.example.com/GDv.jpg"
        sourceMsgId="msg1"
        onClose={vi.fn()}
        serverId="s1"
        channelId="c1"
      />,
    );

    await waitFor(() => {
      // Only the two .jpg images appear; the paste and HTML URLs are excluded.
      const thumbs = screen.getAllByRole("button", { name: /image \d+ of 2/i });
      expect(thumbs).toHaveLength(2);
    });

    vi.mocked(mediaProbe.getCachedProbeResult).mockReturnValue(undefined);
  });
});

describe("topic entry filtering", () => {
  test("topic URL with no known media type is excluded from the filmstrip", async () => {
    // Two message images so the filmstrip renders (requires imageList.length > 1).
    // The channel topic adds a non-media Google Play URL with no cached type.
    // getCachedProbeResult returns undefined → type stays null → filter must exclude it.
    // Correct: 2 filmstrip entries (images 1–2 of 2). Regression: 3 entries (of 3).
    vi.mocked(store.getChannelMessages).mockReturnValueOnce([
      {
        id: "1",
        content: "https://example.com/image.jpg",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
        msgid: "msg1",
      },
      {
        id: "2",
        content: "https://example.com/image2.png",
        serverId: "s1",
        channelId: "c1",
        type: "message",
        timestamp: new Date(),
        userId: "user1",
        reactions: [],
        msgid: "msg2",
      },
    ] as unknown as ReturnType<typeof store.getChannelMessages>);

    const getStateFn = (
      store.default as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState;
    getStateFn.mockReturnValueOnce({
      messages: {},
      servers: [
        {
          id: "s1",
          filehost: null,
          channels: [
            {
              id: "c1",
              topic:
                "app: https://play.google.com/store/apps/details?id=com.example",
            },
          ],
        },
      ],
    });

    render(
      <MediaViewerModal
        isOpen={true}
        url="https://example.com/image.jpg"
        sourceMsgId="msg1"
        onClose={vi.fn()}
        serverId="s1"
        channelId="c1"
      />,
    );

    await waitFor(() => {
      // The Google Play topic URL must NOT generate a filmstrip entry.
      // Only the two message images should appear (2 of 2, not 3 of 3).
      const thumbs = screen.getAllByRole("button", {
        name: /image \d+ of 2/i,
      });
      expect(thumbs).toHaveLength(2);
    });
  });
});
