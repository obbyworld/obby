import { beforeEach, describe, expect, it } from "vitest";
import useStore from "../../src/store";
import type { Message } from "../../src/types";

const pending = (id: string, time: number): Message => ({
  id,
  content: id,
  timestamp: new Date(time),
  userId: "me",
  channelId: "c1",
  serverId: "s1",
  type: "message",
  reactions: [],
  replyMessage: null,
  mentioned: [],
  pendingLabel: id,
  status: "pending",
});

describe("pending messages", () => {
  beforeEach(() => useStore.setState({ messages: {} }));

  it("keeps a burst in send order when the server stamps later times", () => {
    const { addMessage, confirmPendingMessage } = useStore.getState();
    addMessage(pending("one", 1000));
    addMessage(pending("two", 2000));
    confirmPendingMessage("s1", "c1", "one", {
      msgid: "m1",
      timestamp: new Date(9000),
    });
    addMessage(pending("three", 3000));

    const shown = useStore.getState().messages["s1-c1"] ?? [];
    expect(shown.map((m) => m.content)).toEqual(["one", "two", "three"]);
    expect(shown[0]).toMatchObject({ msgid: "m1", status: undefined });
  });
});
