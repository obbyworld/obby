import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelMessageList,
  type ChannelMessageListHandle,
  DEFAULT_VISIBLE_MESSAGE_COUNT,
} from "../../../src/components/layout/ChannelMessageList";
import useStore from "../../../src/store";

vi.mock("../../../src/lib/ircClient", () => ({
  default: {
    sendRaw: vi.fn(),
    on: vi.fn(),
    getCurrentUser: vi.fn(() => ({ id: "u1", username: "tester" })),
    getNick: vi.fn(() => "tester"),
    version: "1.0.0",
  },
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

// Minimal props — channelId:null means no channel lookup, no loading spinner.
const defaultProps = {
  channelKey: "s1::pm:pm1",
  serverId: "s1",
  channelId: null as null,
  privateChatId: "pm1",
  isActive: true,
  isMemberListVisible: false,
  onReply: vi.fn(),
  onUsernameContextMenu: vi.fn(),
  onIrcLinkClick: vi.fn(),
  onReactClick: vi.fn(),
  onReactionUnreact: vi.fn(),
  onOpenReactionModal: vi.fn(),
  onDirectReaction: vi.fn(),
  onRedactMessage: vi.fn(),
  onOpenProfile: vi.fn(),
  joinChannel: vi.fn(),
};

const makeMsg = (
  id: string,
  overrides?: Partial<import("../../../src/types").Message>,
): import("../../../src/types").Message => ({
  id,
  msgid: id,
  type: "message",
  content: `Content of ${id}`,
  timestamp: new Date("2024-01-01T12:00:00Z"),
  userId: "alice",
  channelId: "pm1",
  serverId: "s1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
  ...overrides,
});

describe("ChannelMessageList scroll state", () => {
  beforeEach(() => {
    useStore.setState({ messages: {}, servers: [] });
  });

  it("restores saved position when initialScrollState is provided", () => {
    const ref = createRef<ChannelMessageListHandle>();
    render(
      <ChannelMessageList
        {...defaultProps}
        ref={ref}
        initialScrollState={{ scrollTop: 350, visibleCount: 60 }}
      />,
    );

    const state = ref.current?.getScrollState();
    expect(state?.scrollTop).toBe(350);
    expect(state?.isAtBottom).toBe(false);
    expect(state?.visibleCount).toBe(60);
  });

  it("marks at-bottom when initialScrollState is null (user was at bottom when they left)", () => {
    const ref = createRef<ChannelMessageListHandle>();
    render(
      <ChannelMessageList
        {...defaultProps}
        ref={ref}
        initialScrollState={null}
      />,
    );

    const state = ref.current?.getScrollState();
    expect(state?.isAtBottom).toBe(true);
  });

  it("marks at-bottom and uses default window size when initialScrollState is absent (first visit)", () => {
    const ref = createRef<ChannelMessageListHandle>();
    render(<ChannelMessageList {...defaultProps} ref={ref} />);

    const state = ref.current?.getScrollState();
    expect(state?.isAtBottom).toBe(true);
    expect(state?.visibleCount).toBe(DEFAULT_VISIBLE_MESSAGE_COUNT);
  });
});

describe("ChannelMessageList highlight", () => {
  beforeEach(() => {
    useStore.setState({
      messages: {
        "s1::pm:pm1": [makeMsg("msg-a"), makeMsg("msg-b"), makeMsg("msg-c")],
      },
      servers: [],
    });
  });

  it("applies highlight class to the matching message row", () => {
    const { container } = render(
      <ChannelMessageList {...defaultProps} highlightedMessageId="msg-b" />,
    );

    const highlighted = container.querySelector('[data-message-id="msg-b"]');
    const others = [
      container.querySelector('[data-message-id="msg-a"]'),
      container.querySelector('[data-message-id="msg-c"]'),
    ];

    expect(highlighted?.className).toContain("bg-primary/10");
    expect(highlighted?.className).toContain("ring-1");
    for (const el of others) {
      expect(el?.className).not.toContain("bg-primary/10");
    }
  });

  it("applies no highlight when highlightedMessageId is undefined", () => {
    const { container } = render(
      <ChannelMessageList {...defaultProps} highlightedMessageId={undefined} />,
    );

    for (const id of ["msg-a", "msg-b", "msg-c"]) {
      const el = container.querySelector(`[data-message-id="${id}"]`);
      expect(el?.className).not.toContain("bg-primary/10");
    }
  });
});

describe("ChannelMessageList jump to message", () => {
  const COUNT = DEFAULT_VISIBLE_MESSAGE_COUNT + 50;
  const many = Array.from({ length: COUNT }, (_, i) => makeMsg(`msg-${i}`));

  beforeEach(() => {
    vi.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();
    useStore.setState({ messages: { "s1::pm:pm1": many }, servers: [] });
    useStore.getState().clearMessageJump();
  });

  it("grows the window to reach an older message, then scrolls to it and flashes it", () => {
    const { container } = render(<ChannelMessageList {...defaultProps} />);
    expect(container.querySelector('[data-message-id="msg-5"]')).toBeNull();

    act(() => useStore.getState().revealMessage("msg-5"));

    const row = container.querySelector('[data-message-id="msg-5"]');
    expect(row).not.toBeNull();
    expect(row?.classList).toContain("message-flash");
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(useStore.getState().ui.messageJump).toBeNull();
  });

  it("jumps from a reply quote to the message it answers", () => {
    const original = many[COUNT - 3];
    useStore.setState({
      messages: {
        "s1::pm:pm1": [
          ...many,
          makeMsg("reply", { replyMessage: original, content: "agreed" }),
        ],
      },
    });
    const { container } = render(<ChannelMessageList {...defaultProps} />);

    fireEvent.click(
      container.querySelector(
        '[data-message-id="reply"] [data-reply-quote]',
      ) as Element,
    );

    expect(
      container.querySelector(`[data-message-id="${original.id}"]`)?.classList,
    ).toContain("message-flash");
  });
});

describe("ChannelMessageList history window", () => {
  const KEY = "s1-pm1";
  const props = { ...defaultProps, channelKey: KEY };
  const present = [makeMsg("now-1"), makeMsg("now-2")];
  const past = Array.from({ length: 101 }, (_, i) =>
    makeMsg(`past-${i}`, { timestamp: new Date(Date.UTC(2023, 0, 1, 0, i)) }),
  );
  const server = (isLoadingHistory = false) => ({
    id: "s1",
    name: "TestNet",
    channels: [],
    privateChats: [
      {
        id: "pm1",
        username: "bob",
        serverId: "s1",
        unreadCount: 0,
        isMentioned: false,
        isLoadingHistory,
      },
    ],
  });
  const showPast = () =>
    act(() => {
      useStore.setState({
        messages: { [KEY]: past },
        historyWindows: {
          [KEY]: {
            until: past[100].timestamp.getTime(),
            present,
            jumpId: 1,
          },
        },
      });
      useStore.getState().revealMessage("past-50");
    });

  beforeEach(() => {
    vi.mocked(window.HTMLElement.prototype.scrollIntoView).mockClear();
    useStore.setState({
      messages: { [KEY]: present },
      historyWindows: {},
      globalNotifications: [],
      servers: [server()] as never,
    });
    useStore.getState().clearMessageJump();
  });

  it("flashes the message in a window that replaced the chat and offers the present", () => {
    const { container, getByRole } = render(<ChannelMessageList {...props} />);

    showPast();

    expect(
      container.querySelector('[data-message-id="past-50"]')?.classList,
    ).toContain("message-flash");
    fireEvent.click(getByRole("button", { name: "Jump to present" }));
    expect(useStore.getState().historyWindows[KEY]).toBeUndefined();
    expect(container.querySelector('[data-message-id="now-2"]')).not.toBeNull();
  });

  it("still jumps while a history request never finished", () => {
    useStore.setState({ servers: [server(true)] as never });
    const { container } = render(<ChannelMessageList {...props} />);

    showPast();

    expect(
      container.querySelector('[data-message-id="past-50"]')?.classList,
    ).toContain("message-flash");
  });

  it("shows a toast when the message has no row to scroll to", () => {
    const join = (id: string, username: string) =>
      makeMsg(id, { type: "join", userId: username, content: "" });
    useStore.setState({
      messages: { [KEY]: [join("join-1", "carol"), join("join-2", "dave")] },
    });
    render(<ChannelMessageList {...props} />);

    act(() => useStore.getState().revealMessage("join-1"));

    expect(useStore.getState().globalNotifications.at(-1)).toMatchObject({
      command: "SEARCH_JUMP",
      code: "not-found",
    });
  });
});
