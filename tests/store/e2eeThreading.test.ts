import { beforeEach, describe, expect, test, vi } from "vitest";
import { ObbyE2EEBackend } from "../../src/lib/e2ee/backend";
import {
  decodeE2EEPayload,
  E2EE_BODY_PREFIX,
  E2EE_TAG,
  type E2EEInit,
  encodeE2EEPayload,
} from "../../src/lib/e2ee/protocol";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import {
  registerE2EEHandlers,
  sendEncryptedMessage,
  startE2EESession,
} from "../../src/store/handlers/e2ee";
import {
  confirmEncryptedEcho,
  injectMessage,
} from "../../src/store/handlers/e2eeConversation";

// A decrypted row is built here rather than by the PRIVMSG handler, so it only
// threads if this file threads it: without the msgid it cannot be replied to,
// reacted to, or reached with the reply-navigation keys, and without the reply
// target it renders as an ordinary message.

const serverId = "s1";
const nick = "peer";

function seedServer() {
  useStore.setState({
    servers: [
      {
        id: serverId,
        name: "test",
        host: "irc.test",
        port: 443,
        channels: [],
        privateChats: [],
        isConnected: true,
        users: [],
      } as never,
    ],
    e2eeSessions: {},
    messages: {},
  });
}

function thread() {
  const chat = useStore
    .getState()
    .servers.find((s) => s.id === serverId)
    ?.privateChats?.find((p) => p.username === nick);
  return chat
    ? (useStore.getState().messages[`${serverId}-${chat.id}`] ?? [])
    : [];
}

let sent: string[] = [];

describe("threading of decrypted rows", () => {
  beforeEach(() => {
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("a reply points at the message it answers", () => {
    injectMessage(serverId, nick, nick, "first", { msgid: "m1" });
    injectMessage(serverId, nick, "self", "answering that", {
      msgid: "m2",
      replyTo: "m1",
    });

    expect(thread()[1].replyMessage?.msgid).toBe("m1");
  });

  test("a reply to a message this thread never saw stays unthreaded", () => {
    injectMessage(serverId, nick, nick, "hello", { replyTo: "gone" });

    expect(thread()[0].replyMessage).toBeNull();
  });

  test("our own message adopts the msgid its echo brings back", () => {
    injectMessage(serverId, nick, "self", "sent from here", {
      label: "lr-1",
    });
    expect(thread()[0].msgid).toBeUndefined();

    confirmEncryptedEcho(serverId, nick, "lr-1", "m9");

    expect(thread()[0].msgid).toBe("m9");
  });

  test("an echo for another send leaves the row alone", () => {
    injectMessage(serverId, nick, "self", "sent from here", {
      label: "lr-1",
    });

    confirmEncryptedEcho(serverId, nick, "lr-2", "m9");

    expect(thread()[0].msgid).toBeUndefined();
  });
});

// The echo comes back inside a labeled-response batch, which is also how
// history arrives. Reading it as history would leave a phantom "cannot be
// decrypted" row beside every message the user just sent.
describe("the echo of our own encrypted send", () => {
  beforeEach(() => {
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue({
      id: "u1",
      username: "self",
    } as never);
    registerE2EEHandlers(useStore);
  });

  function deliverOwnEcho(label: string | undefined, msgid: string) {
    ircClient.triggerEvent("USERMSG", {
      serverId,
      sender: "self",
      target: nick,
      message: `${E2EE_BODY_PREFIX}AAAA`,
      timestamp: new Date(),
      mtags: { batch: "b1", msgid, ...(label ? { label } : {}) },
    } as never);
  }

  test("fills in the msgid instead of adding an undecryptable row", () => {
    injectMessage(serverId, nick, "self", "sent from here", { label: "lr-7" });

    deliverOwnEcho("lr-7", "m5");

    expect(thread()).toHaveLength(1);
    expect(thread()[0].msgid).toBe("m5");
  });

  test("an unlabelled replay of our own send names nothing", () => {
    injectMessage(serverId, nick, "self", "sent from here", { label: "lr-7" });

    deliverOwnEcho(undefined, "m6");

    expect(thread()[0].msgid).toBeUndefined();
  });
});

// A ciphertext runs past the body limit at a few dozen characters of text, so
// most real messages arrive in pieces. The receiver reads them on the frame
// that completes the set, which is the frame that has to carry the identity.
describe("a fragmented message keeps one identity", () => {
  beforeEach(() => {
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    vi.spyOn(ircClient, "hasCapability").mockReturnValue(true);
    registerE2EEHandlers(useStore);
    establish();
  });

  // Drive the singleton backend to an established session by answering its own
  // offer with a second client, which is the only way to reach one in-process.
  function establish() {
    startE2EESession(serverId, nick);
    const offer = sent
      .map((line) => line.match(/^@\+obby\.world\/e2ee=(\S+) TAGMSG/)?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => decodeE2EEPayload(value))
      .find((payload) => payload?.t === "init") as E2EEInit;
    const peer = new ObbyE2EEBackend();
    const accept = peer.acceptOffer({ serverId, nick: "self" }, offer);
    ircClient.triggerEvent("TAGMSG", {
      mtags: { [E2EE_TAG]: encodeE2EEPayload(accept) },
      serverId,
      sender: nick,
    } as never);
    sent = [];
  }

  function carrierLines() {
    return sent.filter((line) => line.includes(E2EE_BODY_PREFIX));
  }

  test("only the completing frame names the message", () => {
    sendEncryptedMessage(serverId, nick, "x".repeat(400), "m1");

    const lines = carrierLines();
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).some((l) => l.includes("+reply="))).toBe(false);
    expect(lines.slice(0, -1).some((l) => l.includes("label="))).toBe(false);
    expect(lines[lines.length - 1]).toContain("+reply=m1");
    expect(lines[lines.length - 1]).toContain("label=");
  });

  test("no frame carries the plaintext", () => {
    sendEncryptedMessage(serverId, nick, "CANARY-PLAINTEXT-VALUE");

    expect(sent.some((l) => l.includes("CANARY-PLAINTEXT-VALUE"))).toBe(false);
  });
});
