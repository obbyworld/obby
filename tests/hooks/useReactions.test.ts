import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReactions } from "../../src/hooks/useReactions";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Message } from "../../src/types";

vi.mock("../../src/lib/ircClient", () => ({
  default: { sendRaw: vi.fn(), on: vi.fn() },
}));

const message: Message = {
  id: "m1",
  msgid: "abc",
  type: "message",
  content: "hi",
  timestamp: new Date(),
  userId: "alice",
  channelId: "chan1",
  serverId: "s1",
  reactions: [],
  replyMessage: null,
  mentioned: [],
};

describe("useReactions", () => {
  // Every message row receives these callbacks, so a new identity re-renders the whole chat.
  it("keeps the row callbacks while the store and the user change", () => {
    const { result, rerender } = renderHook(
      ({ name }) =>
        useReactions({
          selectedServerId: "s1",
          currentUser: { id: "u", username: name } as never,
        }),
      { initialProps: { name: "tester" } },
    );
    const { directReaction, unreact, openReactionModal } = result.current;

    act(() => useStore.setState({ servers: [], messages: {} }));
    rerender({ name: "tester2" });

    expect(result.current.directReaction).toBe(directReaction);
    expect(result.current.unreact).toBe(unreact);
    expect(result.current.openReactionModal).toBe(openReactionModal);
  });

  it("reacts as the current user after a nick change", () => {
    useStore.setState({
      servers: [
        {
          id: "s1",
          channels: [{ id: "chan1", name: "#a", users: [] }],
          privateChats: [],
        },
      ] as never,
      messages: { "s1-chan1": [message] },
    });
    const { result, rerender } = renderHook(
      ({ name }) =>
        useReactions({
          selectedServerId: "s1",
          currentUser: { id: "u", username: name } as never,
        }),
      { initialProps: { name: "tester" } },
    );
    rerender({ name: "renamed" });

    act(() => result.current.directReaction("👍", message));

    expect(useStore.getState().messages["s1-chan1"][0].reactions).toEqual([
      { emoji: "👍", userId: "renamed" },
    ]);
  });

  it("keeps a msgid with a line break inside its tag", () => {
    const hostile = { ...message, msgid: "x\nNICK pwned" };
    useStore.setState({
      servers: [
        {
          id: "s1",
          channels: [{ id: "chan1", name: "#a", users: [] }],
          privateChats: [],
        },
      ] as never,
      messages: { "s1-chan1": [hostile] },
    });
    const sendRaw = vi.mocked(ircClient.sendRaw);
    sendRaw.mockClear();
    const { result } = renderHook(() =>
      useReactions({
        selectedServerId: "s1",
        currentUser: { id: "u", username: "me" } as never,
      }),
    );

    act(() => result.current.directReaction("a b", hostile));
    act(() => result.current.unreact("a b", hostile));

    expect(sendRaw.mock.calls).toEqual([
      [
        "s1",
        "@+draft/react=a\\sb;+reply=x\\nNICK\\spwned;+draft/reply=x\\nNICK\\spwned TAGMSG #a",
      ],
      [
        "s1",
        "@+draft/unreact=a\\sb;+reply=x\\nNICK\\spwned;+draft/reply=x\\nNICK\\spwned TAGMSG #a",
      ],
    ]);
  });
});
