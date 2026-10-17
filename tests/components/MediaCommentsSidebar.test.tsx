import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MediaCommentsSidebar } from "../../src/components/ui/MediaCommentsSidebar";
import { useMessageSending } from "../../src/hooks/useMessageSending";
import type { Message } from "../../src/types";

// --- Mocks ---

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    sendRaw: vi.fn(),
    getCurrentUser: vi.fn(() => ({ id: "u1", username: "testuser" })),
  },
}));

vi.mock("../../src/hooks/useMessageSending", () => ({
  useMessageSending: vi.fn(() => ({ sendMessage: vi.fn() })),
}));

vi.mock("../../src/hooks/useReactions", () => ({
  useReactions: vi.fn(() => ({
    directReaction: vi.fn(),
    unreact: vi.fn(),
    reactionModal: { isOpen: false, message: null },
    openReactionModal: vi.fn(),
    closeReactionModal: vi.fn(),
    selectReaction: vi.fn(),
  })),
}));

vi.mock("../../src/hooks/useScrollToBottom", () => ({
  useScrollToBottom: vi.fn(() => ({
    isScrolledUp: false,
    wasAtBottomRef: { current: true },
    scrollToBottom: vi.fn(),
  })),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "linux"),
}));

const mockChannel = {
  id: "c1",
  name: "#test",
  users: [],
  isLoadingHistory: false,
};

vi.mock("../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        servers: [{ id: "s1", channels: [mockChannel] }],
        messages: {},
        globalSettings: { mediaVisibilityLevel: 3 },
        typingUsers: {},
      };
      return selector(state);
    }),
    { getState: vi.fn(() => ({ messages: {}, servers: [] })) },
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Fixtures ---

const sourceMessage: Message = {
  id: "msg1",
  content: "Check this image https://example.com/img.png",
  timestamp: new Date("2024-01-01T12:00:00Z"),
  userId: "alice",
  serverId: "s1",
  channelId: "c1",
  type: "message",
  reactions: [],
  msgid: "abc123",
  replyMessage: null,
  mentioned: [],
};

const defaultProps = {
  sourceMessage,
  currentImageUrl: "https://example.com/img.png",
  serverId: "s1",
  channelId: "c1",
  isAlbum: false,
  isMobile: false,
  onClose: vi.fn(),
  onCloseAll: vi.fn(),
  onImageClick: vi.fn(),
};

// --- Tests ---

describe("MediaCommentsSidebar", () => {
  test("renders without crashing (regression: getPreviewStyles called with wrong args)", () => {
    // Catches the bug where getPreviewStyles(selectedColor, selectedFormatting) was
    // called instead of getPreviewStyles({ color, formatting }) — null as options crashed.
    expect(() =>
      render(<MediaCommentsSidebar {...defaultProps} />),
    ).not.toThrow();
  });

  test("textarea has no inline color style by default (regression: black text bug)", () => {
    // getPreviewStyles returns color:"inherit" which as an inline style overrides the
    // Tailwind text class and makes the text black in the modal DOM tree.
    // previewStyle must NOT be applied when no formatting is active.
    render(<MediaCommentsSidebar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Reply in/);
    // No inline color style should be set when selectedColor is null and no formatting
    expect(textarea).not.toHaveStyle({ color: "inherit" });
    expect(textarea).not.toHaveStyle({ color: "black" });
  });

  test("shows Comments header", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(screen.getByText("Comments")).toBeInTheDocument();
  });

  test("shows channel name in header", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(screen.getByText("#test")).toBeInTheDocument();
  });

  test("shows context strip with source author", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(screen.getByText(/@alice/)).toBeInTheDocument();
  });

  test("shows 'No comments yet' when empty", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  test("input placeholder mentions channel name", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Reply in #test/);
    expect(textarea).toBeInTheDocument();
  });

  test("has + attachment button", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /attachment options/i }),
    ).toBeInTheDocument();
  });

  test("has emoji button", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /insert emoji/i }),
    ).toBeInTheDocument();
  });

  test("textarea is disabled when sourceMessage has no msgid", () => {
    const noMsgidProps = {
      ...defaultProps,
      sourceMessage: { ...sourceMessage, msgid: undefined },
    };
    render(<MediaCommentsSidebar {...noMsgidProps} />);
    const textarea = screen.getByPlaceholderText(/Replies unavailable/);
    expect(textarea).toBeDisabled();
  });

  test("typing in textarea updates value", () => {
    render(<MediaCommentsSidebar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Reply in/);
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(textarea).toHaveValue("hello");
  });

  test("Enter key calls sendMessage and clears input", () => {
    const mockSend = vi.fn();
    vi.mocked(useMessageSending).mockReturnValue({ sendMessage: mockSend });

    render(<MediaCommentsSidebar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Reply in/);
    fireEvent.change(textarea, { target: { value: "my reply" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(mockSend).toHaveBeenCalledWith("my reply");
    expect(textarea).toHaveValue("");
  });

  test("Shift+Enter does not send", () => {
    const mockSend = vi.fn();
    vi.mocked(useMessageSending).mockReturnValue({ sendMessage: mockSend });

    render(<MediaCommentsSidebar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Reply in/);
    fireEvent.change(textarea, { target: { value: "draft" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(mockSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("draft");
  });

  test("mobile layout shows back and close buttons", () => {
    render(<MediaCommentsSidebar {...defaultProps} isMobile={true} />);
    expect(
      screen.getByRole("button", { name: /back to image/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close viewer/i }),
    ).toBeInTheDocument();
  });

  test("desktop layout shows close comments button", () => {
    render(<MediaCommentsSidebar {...defaultProps} isMobile={false} />);
    expect(
      screen.getByRole("button", { name: /close comments/i }),
    ).toBeInTheDocument();
  });

  test("onClose called when close button clicked", () => {
    const onClose = vi.fn();
    render(<MediaCommentsSidebar {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close comments/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test("onCloseAll called when X clicked on mobile", () => {
    const onCloseAll = vi.fn();
    render(
      <MediaCommentsSidebar
        {...defaultProps}
        isMobile={true}
        onCloseAll={onCloseAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close viewer/i }));
    expect(onCloseAll).toHaveBeenCalled();
  });

  test("album label shown when isAlbum=true", () => {
    render(<MediaCommentsSidebar {...defaultProps} isAlbum={true} />);
    expect(screen.getByText(/Album/)).toBeInTheDocument();
  });

  test("image label shown when isAlbum=false", () => {
    render(<MediaCommentsSidebar {...defaultProps} isAlbum={false} />);
    expect(screen.getByText(/^Image/)).toBeInTheDocument();
  });
});
