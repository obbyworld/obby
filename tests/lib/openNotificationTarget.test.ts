import { afterEach, describe, expect, it, vi } from "vitest";

const jump = vi.hoisted(() => ({
  jumpToMessage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/lib/jumpToMessage", () => jump);

import { openNotificationTarget } from "../../src/lib/openNotificationTarget";
import useStore from "../../src/store";
import type { Message, Server } from "../../src/types";

const serverWith = (isLoadingHistory: boolean, isConnected = true) =>
  [
    {
      id: "s1",
      isConnected,
      capabilities: ["draft/chathistory"],
      channels: [{ name: "#dev", isLoadingHistory }],
      privateChats: [],
    },
  ] as unknown as Server[];

const loadedMessage = { "s1-dev": [{ msgid: "m1" }] as unknown as Message[] };

const tap = () =>
  openNotificationTarget({
    serverId: "s1",
    target: "#dev",
    time: 1,
    msgid: "m1",
  });

const initialState = useStore.getState();

describe("opening a tapped notification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    jump.jumpToMessage.mockClear();
    useStore.setState(initialState, true);
  });

  it("jumps once the chat has loaded the history that holds the message", async () => {
    useStore.setState({ servers: serverWith(true), messages: loadedMessage });

    const opening = tap();
    await Promise.resolve();
    expect(jump.jumpToMessage).not.toHaveBeenCalled();

    useStore.setState({ servers: serverWith(false) });
    await opening;

    expect(jump.jumpToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgid: "m1" }),
    );
  });

  it("waits for the first page of a channel rejoined after connecting", async () => {
    useStore.setState({
      servers: serverWith(false, false),
      messages: loadedMessage,
    });

    const opening = tap();
    useStore.setState({ servers: serverWith(false) });
    await new Promise((resolve) => setTimeout(resolve));
    expect(jump.jumpToMessage).not.toHaveBeenCalled();

    useStore.setState({ servers: serverWith(true) });
    useStore.setState({ servers: serverWith(false) });
    await opening;

    expect(jump.jumpToMessage).toHaveBeenCalled();
  });

  it("opens the chat without a jump when the message is nowhere to be found", async () => {
    const openChat = vi.fn(() => null);
    useStore.setState({
      servers: serverWith(false).map((s) => ({ ...s, capabilities: [] })),
      openChat,
    });

    await tap();

    expect(jump.jumpToMessage).not.toHaveBeenCalled();
    expect(openChat).toHaveBeenCalledWith("s1", "#dev");
  });

  it("jumps once the page is visible", async () => {
    useStore.setState({ servers: serverWith(false), messages: loadedMessage });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    const opening = tap();
    await new Promise((resolve) => setTimeout(resolve));
    expect(jump.jumpToMessage).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await opening;

    expect(jump.jumpToMessage).toHaveBeenCalled();
  });
});
