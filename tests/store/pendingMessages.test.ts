import { beforeEach, describe, expect, it } from "vitest";
import useStore from "../../src/store";
import type { Message } from "../../src/types";

const message = (id: string, time: number, userId = "me"): Message => ({
  id,
  content: id,
  timestamp: new Date(time),
  userId,
  channelId: "c1",
  serverId: "s1",
  type: "message",
  reactions: [],
  replyMessage: null,
  mentioned: [],
});

const pending = (id: string, localTime: number): Message => ({
  ...message(id, localTime),
  pendingLabel: id,
  status: "pending",
});

const echo = (label: string, serverTime: number) =>
  useStore.getState().confirmPendingMessage("s1", "c1", label, {
    msgid: `m-${label}`,
    timestamp: new Date(serverTime),
  });

const shown = () =>
  (useStore.getState().messages["s1-c1"] ?? []).map((m) => m.content);

describe("pending messages", () => {
  beforeEach(() => useStore.setState({ messages: {} }));

  it("keeps a burst in send order when the server stamps later times", () => {
    const { addMessage } = useStore.getState();
    addMessage(pending("one", 1000));
    addMessage(pending("two", 2000));
    echo("one", 9000);
    addMessage(pending("three", 3000));

    expect(shown()).toEqual(["one", "two", "three"]);
    expect(useStore.getState().messages["s1-c1"]?.[0]).toMatchObject({
      msgid: "m-one",
      status: undefined,
    });
  });

  it("shows a pending line below every message while our clock runs behind", () => {
    const { addMessage } = useStore.getState();
    addMessage(message("theirs", 10_000, "them"));
    addMessage(pending("mine", 5_000));

    expect(shown()).toEqual(["theirs", "mine"]);
  });

  it("places our echoed line at the server's time when our clock runs behind", () => {
    const { addMessage } = useStore.getState();
    addMessage(message("theirs", 10_000, "them"));
    addMessage(pending("mine", 5_000));
    echo("mine", 11_000);
    addMessage(message("later", 12_000, "them"));

    expect(shown()).toEqual(["theirs", "mine", "later"]);
    expect(useStore.getState().messages["s1-c1"]?.[1].timestamp).toEqual(
      new Date(11_000),
    );
  });

  it("places our echoed line at the server's time when our clock runs ahead", () => {
    const { addMessage } = useStore.getState();
    addMessage(pending("mine", 20_000));
    echo("mine", 11_000);
    addMessage(message("theirs", 12_000, "them"));

    expect(shown()).toEqual(["mine", "theirs"]);
  });

  it("orders a burst around a line someone else sent in between", () => {
    const { addMessage } = useStore.getState();
    addMessage(pending("one", 1000));
    addMessage(pending("two", 1001));
    echo("one", 9000);
    addMessage(message("theirs", 9500, "them"));
    expect(shown()).toEqual(["one", "theirs", "two"]);

    echo("two", 10_000);
    expect(shown()).toEqual(["one", "theirs", "two"]);
  });

  it("marks a line the server never echoed as failed", () => {
    const { addMessage, failPendingMessage } = useStore.getState();
    addMessage(pending("mine", 5_000));
    failPendingMessage("s1", "c1", "mine");

    expect(useStore.getState().messages["s1-c1"]?.[0].status).toBe("failed");
  });
});
