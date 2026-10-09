import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidePane } from "../../../src/components/layout/SidePane";
import { GlobalNotifications } from "../../../src/components/ui/GlobalNotifications";
import { jumpToMessage } from "../../../src/lib/jumpToMessage";
import type {
  SearchHit,
  SearchQuery,
} from "../../../src/lib/search/searchTypes";
import useStore from "../../../src/store";
import { searchSavedMessages } from "../../../src/store/handlers/history";

vi.mock("../../../src/store/handlers/history", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchSavedMessages: vi.fn(),
}));

vi.mock("../../../src/lib/jumpToMessage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  jumpToMessage: vi.fn(() => Promise.resolve({ ok: true })),
}));

const search = vi.mocked(searchSavedMessages);
const NOW = Date.now();

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  serverId: "server1",
  target: "#general",
  time: NOW - 60_000,
  nick: "alice",
  text: "the deploy finished fine",
  msgid: "m1",
  isAboutMe: false,
  ...overrides,
});

const chatScope = {
  kind: "chat",
  serverId: "server1",
  target: "#general",
} as const;

function openPane(query: Partial<SearchQuery> = {}, isNarrowView = false) {
  const state = useStore.getState();
  useStore.setState({
    servers: [
      {
        id: "server1",
        name: "TestNet",
        host: "irc.test",
        port: 6667,
        isConnected: true,
        users: [],
        channels: [
          {
            id: "chan1",
            name: "#general",
            isPrivate: false,
            serverId: "server1",
            unreadCount: 0,
            isMentioned: false,
            messages: [],
            users: [{ id: "u1", username: "alice", isOnline: true }],
          },
        ],
        privateChats: [],
      },
    ],
    ui: {
      ...state.ui,
      isNarrowView,
      selectedServerId: "server1",
      perServerSelections: {
        server1: { selectedChannelId: "chan1", selectedPrivateChatId: null },
      },
      sidePane: {
        kind: "search",
        query: { text: "deploy", scope: chatScope, ...query },
      },
    },
  } as never);
  return render(<SidePane />);
}

const currentPane = () => useStore.getState().ui.sidePane;
const currentQuery = () => {
  const pane = currentPane();
  return pane?.kind === "search" ? pane.query : undefined;
};

describe("SearchPane", () => {
  beforeEach(() => {
    search.mockReset();
    vi.mocked(jumpToMessage).mockClear();
  });

  it("shows each hit with its nick, chat, time and the match highlighted", async () => {
    search.mockResolvedValue({ hits: [hit()] });
    openPane();

    const row = (await screen.findByText("alice")).closest("li");
    expect(row).toHaveTextContent("#general");
    expect(row).toHaveTextContent("1 minute ago");
    expect(screen.getByText("deploy").tagName).toBe("MARK");
    expect(screen.getByText(/1 result · newest first · #general/)).toBeTruthy();
  });

  it("names the network next to the chat when searching everywhere", async () => {
    search.mockResolvedValue({ hits: [hit()] });
    openPane({ scope: { kind: "everywhere" } });

    expect(await screen.findByText("#general · TestNet")).toBeInTheDocument();
  });

  it("reads the next page from nextBeforeTime and appends it", async () => {
    search
      .mockResolvedValueOnce({ hits: [hit()], nextBeforeTime: 500 })
      .mockResolvedValueOnce({
        hits: [hit({ msgid: "m2", nick: "bob", time: 400 })],
      });
    openPane();

    expect(await screen.findByText("1+ results · newest first · #general"));
    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));

    expect(await screen.findByText("bob")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(useStore, currentQuery(), {
      limit: 50,
      beforeTime: 500,
    });
    expect(
      screen.queryByRole("button", { name: "Load more results" }),
    ).not.toBeInTheDocument();
  });

  it("offers to widen the scope when nothing matches", async () => {
    search.mockResolvedValue({ hits: [] });
    openPane();

    expect(
      await screen.findByText(
        "No messages match. Widen the scope or change filters",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Widen the scope" }));

    expect(currentQuery()?.scope).toEqual({
      kind: "network",
      serverId: "server1",
    });
  });

  it("shows an error and searches again on request", async () => {
    search.mockRejectedValueOnce(new Error("disk")).mockResolvedValue({
      hits: [hit()],
    });
    openPane();

    fireEvent.click(
      await screen.findByRole("button", { name: "Search again" }),
    );

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("splits mentions from replies in the about me view", async () => {
    search.mockResolvedValue({
      hits: [
        hit({
          msgid: "m1",
          nick: "alice",
          text: "tester: look",
          isAboutMe: true,
          aboutMe: "mention",
        }),
        hit({
          msgid: "m2",
          nick: "bob",
          text: "agreed",
          isAboutMe: true,
          aboutMe: "reply",
        }),
      ],
    });
    openPane({ text: "", aboutMe: true });
    await screen.findByText("alice");

    fireEvent.click(screen.getByRole("button", { name: "Mentions" }));
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replies" }));
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });

  it("re-runs the search when a filter chip toggles", async () => {
    search.mockResolvedValue({ hits: [] });
    openPane();
    await screen.findByText(/No messages match/);

    fireEvent.click(screen.getByRole("button", { name: "Has link" }));
    expect(currentQuery()).toMatchObject({ text: "deploy", hasLink: true });

    fireEvent.click(screen.getByRole("button", { name: "Mentions & replies" }));
    expect(currentQuery()).toMatchObject({ hasLink: true, aboutMe: true });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  });

  it("re-runs the edited query on Enter", async () => {
    search.mockResolvedValue({ hits: [] });
    openPane();
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("deploy");

    fireEvent.change(input, { target: { value: "release from:bob" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(currentQuery()).toEqual({
      text: "release",
      from: "bob",
      scope: chatScope,
    });
  });

  it("runs with no filters once the only filter chip toggles off", async () => {
    search.mockResolvedValue({ hits: [] });
    openPane({ text: "", hasLink: true });
    await screen.findByText(/No messages match/);

    fireEvent.click(screen.getByRole("button", { name: "Has link" }));

    expect(currentQuery()).toEqual({ text: "", scope: chatScope });
  });

  it("jumps to a hit and keeps the results open", async () => {
    search.mockResolvedValue({ hits: [hit()] });
    openPane();

    fireEvent.click(await screen.findByText("alice"));

    expect(jumpToMessage).toHaveBeenCalledWith(hit());
    await waitFor(() =>
      expect(currentPane()).toMatchObject({ isChatShown: true }),
    );
  });

  it("keeps the results and shows a translated toast when a jump fails", async () => {
    vi.mocked(jumpToMessage).mockResolvedValueOnce({
      ok: false,
      reason: "not-saved",
    });
    search.mockResolvedValue({ hits: [hit()] });
    openPane({}, true);
    useStore.setState((state) => ({
      ui: { ...state.ui, mobileViewActiveColumn: "chatView" },
    }));

    fireEvent.click(await screen.findByText("alice"));

    await waitFor(() =>
      expect(useStore.getState().globalNotifications.at(-1)).toMatchObject({
        command: "SEARCH_JUMP",
        code: "not-saved",
      }),
    );
    expect(currentPane()).toMatchObject({ isChatShown: false });
    expect(useStore.getState().ui.mobileViewActiveColumn).toBe("memberList");
    render(<GlobalNotifications />);
    expect(
      screen.getByText("This message is no longer saved"),
    ).toBeInTheDocument();
  });

  it.each([
    ["left-channel", "Join this channel to jump to the message"],
    ["not-saved", "This message is no longer saved"],
    ["not-found", "Could not find this message"],
  ] as const)("shows a toast when a jump fails with %s", async (reason, text) => {
    useStore.setState({ globalNotifications: [] });
    vi.mocked(jumpToMessage).mockResolvedValueOnce({ ok: false, reason });
    search.mockResolvedValue({ hits: [hit()] });
    openPane();
    render(<GlobalNotifications />);

    fireEvent.click(await screen.findByText("alice"));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("shows a toast when reading saved history fails during a jump", async () => {
    useStore.setState({ globalNotifications: [] });
    vi.mocked(jumpToMessage).mockRejectedValueOnce(
      new DOMException("history database is blocked", "AbortError"),
    );
    search.mockResolvedValue({ hits: [hit()] });
    openPane();
    render(<GlobalNotifications />);

    fireEvent.click(await screen.findByText("alice"));

    expect(
      await screen.findByText("Could not find this message"),
    ).toBeInTheDocument();
  });

  it("asks for one more page at a time", async () => {
    search.mockResolvedValueOnce({ hits: [hit()], nextBeforeTime: 500 });
    search.mockReturnValueOnce(new Promise(() => {}));
    openPane();
    const more = await screen.findByRole("button", {
      name: "Load more results",
    });

    fireEvent.click(more);
    fireEvent.scroll(more.closest(".overflow-y-auto") as HTMLElement);

    expect(search).toHaveBeenCalledTimes(2);
  });

  it("is a combobox with a status line, closed by Escape", async () => {
    search.mockResolvedValue({ hits: [hit()] });
    openPane();
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls");
    expect(await screen.findByRole("status")).toHaveTextContent("1 result");

    fireEvent.change(input, { target: { value: "from:al" } });
    fireEvent.focus(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      `${input.getAttribute("aria-controls")}-0`,
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(currentPane()).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(currentPane()).toBeNull();
  });

  it("closes and clears the results", async () => {
    search.mockResolvedValue({ hits: [] });
    openPane();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(currentPane()).toBeNull();
  });
});
