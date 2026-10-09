import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickActions from "../../../src/components/ui/QuickActions";
import ircClient from "../../../src/lib/ircClient";
import {
  getRecentSearches,
  recordPlace,
  recordSearch,
} from "../../../src/lib/search/recents";
import type { AppState } from "../../../src/store";
import useStore from "../../../src/store";

let isTouch = false;
vi.mock("../../../src/hooks/useIsTouchInput", () => ({
  useIsTouchInput: () => isTouch,
}));

const SID = "srv-1";
const user = (username: string) => ({ id: username, username, isOnline: true });
const channel = (id: string, name: string, users: string[] = []) => ({
  id,
  name,
  isPrivate: false,
  serverId: SID,
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: users.map(user),
});
const chatScope = { kind: "chat", serverId: SID, target: "#dev" } as const;

const realOpenSearchResults = useStore.getState().openSearchResults;
const openSearchResults = vi.fn(realOpenSearchResults);

function setup({ scope }: { scope?: typeof chatScope } = {}) {
  cleanup();
  useStore.setState(
    (state) =>
      ({
        openSearchResults,
        servers: [
          {
            id: SID,
            name: "libera",
            host: "irc.libera.chat",
            port: 6697,
            channels: [
              channel("c1", "#dev", ["me", "alice", "albert"]),
              channel("c2", "#random"),
            ],
            privateChats: [],
            isConnected: true,
            users: [],
          },
        ],
        ui: {
          ...state.ui,
          selectedServerId: SID,
          perServerSelections: {
            [SID]: { selectedChannelId: "c1", selectedPrivateChatId: null },
          },
          quickActions: scope ? { mode: "messages", scope } : { mode: "goto" },
          isNarrowView: false,
        },
        globalSettings: { ...state.globalSettings, keepHistory: true },
      }) as unknown as Partial<AppState>,
  );
  render(<Palette />);
  return screen.getByRole("combobox");
}

const Palette = () => {
  const isOpen = useStore((s) => !!s.ui.quickActions);
  return isOpen ? <QuickActions /> : null;
};

const modeButton = (name: string) => screen.getByRole("button", { name });
const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });

describe("QuickActions palette", () => {
  beforeEach(() => {
    isTouch = false;
    openSearchResults.mockClear();
    const data = new Map<string, string>();
    window.localStorage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    } as unknown as Storage;
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue(
      user("me") as ReturnType<typeof ircClient.getCurrentUser>,
    );
  });

  it("opens in Go to and offers a message search as the last row", () => {
    const input = setup();
    expect(modeButton("Go to")).toHaveAttribute("aria-pressed", "true");
    type(input, "rand");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("#random");
    expect(options[options.length - 1]).toHaveTextContent(
      'Search messages for "rand"',
    );
  });

  it("flips mode on the app's Cmd+K toggle and keeps the text", () => {
    const input = setup();
    type(input, "deploy");
    act(() => useStore.getState().toggleQuickActions());
    expect(modeButton("Messages")).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveValue("deploy");
    act(() => useStore.getState().toggleQuickActions());
    expect(modeButton("Go to")).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveValue("deploy");
  });

  it("leaves Tab to move focus", () => {
    const input = setup();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false);
    expect(modeButton("Go to")).toHaveAttribute("aria-pressed", "true");
  });

  it("clears recent searches from the group header", () => {
    recordSearch({ text: "release notes", scope: { kind: "everywhere" } });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("release notes")).not.toBeInTheDocument();
    expect(getRecentSearches()).toEqual([]);
  });

  it("drops recent searches scoped to a removed server", () => {
    recordSearch({
      text: "gone",
      scope: { kind: "network", serverId: "removed" },
    });
    setup();
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
  });

  it("does not remember searches with history off", () => {
    const input = setup({ scope: chatScope });
    useStore.setState((state) => ({
      globalSettings: { ...state.globalSettings, keepHistory: false },
    }));
    type(input, "secret");
    press("Enter");
    expect(openSearchResults).toHaveBeenCalled();
    expect(getRecentSearches()).toEqual([]);
  });

  it("runs a filter-only query on Enter", () => {
    const input = setup({ scope: chatScope });
    type(input, "in:#random");
    press("Escape");
    press("Enter");
    expect(openSearchResults).toHaveBeenCalledWith({
      text: "",
      scope: { kind: "chat", serverId: SID, target: "#random" },
    });
  });

  it("opens a start-dm result by its nick", () => {
    const input = setup();
    type(input, "albert");
    fireEvent.click(screen.getByRole("option", { name: /Message albert/ }));
    const server = useStore.getState().servers[0];
    const pm = server.privateChats.find((p) => p.username === "albert");
    expect(pm).toBeDefined();
    expect(
      useStore.getState().ui.perServerSelections[SID].selectedPrivateChatId,
    ).toBe(pm?.id);
  });

  it("returns focus where it came from on desktop and leaves it alone on touch", () => {
    const pill = document.createElement("button");
    document.body.appendChild(pill);
    pill.focus();
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(pill);
    pill.remove();

    isTouch = true;
    setup();
    const requestFocus = vi.spyOn(useStore.getState(), "requestChatInputFocus");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(requestFocus).not.toHaveBeenCalled();
  });

  it("announces the wider scope and ignores held Backspace", () => {
    setup({ scope: chatScope });
    const chip = screen.getByRole("button", { name: "Choose where to search" });
    press("Backspace", { repeat: true });
    expect(chip).toHaveTextContent("#dev");
    press("Backspace");
    expect(chip).toHaveTextContent("libera");
    expect(screen.getByRole("status")).toHaveTextContent("Searching in libera");
  });

  it("shows recent searches and places when empty", () => {
    recordSearch({ text: "release notes", scope: { kind: "everywhere" } });
    recordPlace({ serverId: SID, name: "#random", kind: "channel" });
    setup();
    expect(screen.getByText("Recent searches")).toBeInTheDocument();
    expect(screen.getByText("release notes")).toBeInTheDocument();
    expect(screen.getByText("Recent places")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /#random/ })).toBeInTheDocument();
  });

  it("widens the scope one level per Backspace on an empty input", () => {
    setup({ scope: chatScope });
    const chip = screen.getByRole("button", { name: "Choose where to search" });
    expect(chip).toHaveTextContent("#dev");
    press("Backspace");
    expect(chip).toHaveTextContent("libera");
    press("Backspace");
    expect(chip).toHaveTextContent("Everywhere");
  });

  it("runs the parsed query on Enter and remembers it", () => {
    const input = setup({ scope: chatScope });
    expect(modeButton("Messages")).toHaveAttribute("aria-pressed", "true");
    type(input, "deploy has:link mentions:me");
    press("Enter");
    const expected = {
      text: "deploy",
      scope: chatScope,
      hasLink: true,
      aboutMe: true,
    };
    expect(openSearchResults).toHaveBeenCalledWith(expected);
    expect(getRecentSearches()).toEqual([expected]);
    expect(useStore.getState().ui.sidePane).toEqual({
      kind: "search",
      query: expected,
    });
  });

  it("completes from: with nicks of the scoped network", () => {
    const input = setup({ scope: chatScope });
    type(input, "from:al");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["albert", "alice"]);
    press("ArrowDown");
    press("Enter");
    expect(input).toHaveValue("from:alice ");
    expect(openSearchResults).not.toHaveBeenCalled();
  });

  it("toggles filter chips into the text", () => {
    const input = setup({ scope: chatScope });
    fireEvent.click(screen.getByRole("button", { name: "Has link" }));
    expect(input).toHaveValue("has:link ");
    fireEvent.click(screen.getByRole("button", { name: "Has link" }));
    expect(input).toHaveValue("");
  });

  it("is a full-screen sheet with large targets on touch", () => {
    isTouch = true;
    const input = setup({ scope: chatScope });
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(modeButton("Messages").className).toContain("min-h-11");
    const chip = screen.getByRole("button", { name: "Choose where to search" });
    expect(chip.className).toContain("min-w-0");
    expect(chip.parentElement?.className).toContain("overflow-x-auto");
    expect(chip.querySelector(".truncate")).toHaveTextContent("#dev");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitem", { name: /Everywhere/ }));
    type(input, "hello");
    press("Enter");
    expect(openSearchResults).toHaveBeenCalledWith({
      text: "hello",
      scope: { kind: "everywhere" },
    });
  });

  it("closes on Escape", () => {
    setup();
    press("Escape");
    expect(useStore.getState().ui.quickActions).toBeNull();
  });
});
