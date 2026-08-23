import { beforeEach, describe, expect, test, vi } from "vitest";
import { ObbyE2EEBackend } from "../../src/lib/e2ee/backend";
import { isUndecryptableMessage } from "../../src/lib/e2ee/messageFlags";
import { obbyPeerTrust } from "../../src/lib/e2ee/obbyIdentity";
import {
  E2EE_BODY_PREFIX,
  E2EE_TAG,
  encodeE2EEPayload,
  PROTOCOL_VERSION,
} from "../../src/lib/e2ee/protocol";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import {
  dropE2EESessionForDisconnect,
  handleInboundObby,
  keepsOwnOffer,
  registerE2EEHandlers,
  resetE2EESession,
  resumeE2EEIfKnown,
  startE2EESession,
} from "../../src/store/handlers/e2ee";
import {
  injectMediaMessage,
  injectMessage,
} from "../../src/store/handlers/e2eeConversation";

// Ratchet state lives only in memory, so every reload leaves one side holding
// keys the other has already thrown away. These cover what happens next: the
// conversation re-encrypts itself where consent already exists, and says so on
// the messages it could not open.

const serverId = "s1";
let sent: string[] = [];

// The global setup stubs localStorage with no-op spies; peer pinning is the
// whole subject here, so it needs one that actually stores.
const stored = new Map<string, string>();
const workingLocalStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => {
    stored.set(key, String(value));
  },
  removeItem: (key: string) => {
    stored.delete(key);
  },
  clear: () => stored.clear(),
};

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

function sessionOf(nick: string) {
  return useStore.getState().e2eeSessions[`${serverId}:${nick}`];
}

function privateChatNames() {
  return (
    useStore
      .getState()
      .servers.find((s) => s.id === serverId)
      ?.privateChats?.map((p) => p.username) ?? []
  );
}

function messagesWith(nick: string) {
  const chat = useStore
    .getState()
    .servers.find((s) => s.id === serverId)
    ?.privateChats?.find((p) => p.username === nick);
  return chat
    ? (useStore.getState().messages[`${serverId}-${chat.id}`] ?? [])
    : [];
}

// A peer's client, so the offers under test carry a real bundle and a real
// fingerprint rather than a stub the trust store would never match.
function peerOffer(nick: string) {
  const peer = new ObbyE2EEBackend();
  const init = peer.startSession({ serverId, nick: "self" });
  return { init, fingerprint: peer.offeredFingerprint(init) };
}

function deliverTag(nick: string, payload: unknown) {
  ircClient.triggerEvent("TAGMSG", {
    mtags: { [E2EE_TAG]: encodeE2EEPayload(payload as never) },
    serverId,
    sender: nick,
  } as never);
}

describe("encryption survives a peer reload", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("a peer we have already encrypted with is accepted without asking again", () => {
    const { init, fingerprint } = peerOffer("known");
    obbyPeerTrust.pin(serverId, "known", fingerprint);

    deliverTag("known", init);

    expect(sessionOf("known")?.status).toBe("negotiating");
    expect(sent.some((l) => l.startsWith(`@${E2EE_TAG}=`))).toBe(true);
  });

  test("a peer we have never encrypted with still waits for consent", () => {
    const { init } = peerOffer("stranger");

    deliverTag("stranger", init);

    expect(sessionOf("stranger")?.status).toBe("pending-accept");
  });

  test("a pin under a different key is not enough to skip the prompt", () => {
    const { init } = peerOffer("swapped");
    obbyPeerTrust.pin(serverId, "swapped", "SOME-OTHER-FINGERPRINT");

    deliverTag("swapped", init);

    expect(sessionOf("swapped")?.status).toBe("pending-accept");
  });

  test("ciphertext we cannot open leaves a row and re-offers encryption", () => {
    const { fingerprint } = peerOffer("resumer");
    obbyPeerTrust.pin(serverId, "resumer", fingerprint);

    const frame = encodeE2EEPayload({
      t: "msg",
      v: PROTOCOL_VERSION,
      ct: "not-openable",
    });
    handleInboundObby(
      serverId,
      "resumer",
      undefined,
      `${E2EE_BODY_PREFIX}${frame}`,
      "msgid-1",
    );

    expect(messagesWith("resumer").some(isUndecryptableMessage)).toBe(true);
    expect(sessionOf("resumer")?.status).toBe("negotiating");
  });

  test("ending encryption by hand stops it coming back on its own", () => {
    const { fingerprint } = peerOffer("finished");
    obbyPeerTrust.pin(serverId, "finished", fingerprint);

    resetE2EESession(serverId, "finished");
    sent = [];
    resumeE2EEIfKnown(serverId, "finished");

    expect(sent).toHaveLength(0);
    expect(sessionOf("finished")?.status ?? "none").toBe("none");
  });
});

// An offer is an unauthenticated frame carrying only a nickname, so anything
// that can hold that nick can send one. It must never be able to take a live
// conversation apart: `pending-accept` sends in the clear, so a teardown that
// lands there turns one forged frame into a downgrade.
describe("a live session survives an unauthenticated offer", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  function withEstablishedSession(nick: string, fingerprint: string) {
    useStore.setState({
      e2eeSessions: {
        [`${serverId}:${nick}`]: {
          status: "established",
          scheme: "obby",
          verified: true,
          peerFingerprint: fingerprint,
        },
      },
    });
  }

  test("an offer under an unknown key never reaches a state that sends plaintext", () => {
    const { init } = peerOffer("victim");
    obbyPeerTrust.pin(serverId, "victim", "THE-KEY-WE-TRUST");
    withEstablishedSession("victim", "THE-KEY-WE-TRUST");

    deliverTag("victim", init);

    expect(sessionOf("victim")?.status).not.toBe("pending-accept");
    expect(sessionOf("victim")?.status).not.toBe("none");
    // A different key is exactly what a man-in-the-middle looks like, so it
    // surfaces as a key change, which withholds until the user rules on it.
    expect(sessionOf("victim")?.status).toBe("key-changed");
  });

  test("a garbage bundle cannot tear the session down either", () => {
    obbyPeerTrust.pin(serverId, "victim2", "THE-KEY-WE-TRUST");
    withEstablishedSession("victim2", "THE-KEY-WE-TRUST");

    deliverTag("victim2", {
      t: "init",
      v: PROTOCOL_VERSION,
      bundle: "not-a-bundle",
    });

    expect(sessionOf("victim2")?.status).not.toBe("pending-accept");
    expect(sessionOf("victim2")?.status).not.toBe("none");
  });

  test("the peer's own key still replaces the session, so a reload recovers", () => {
    const { init, fingerprint } = peerOffer("reloader");
    obbyPeerTrust.pin(serverId, "reloader", fingerprint);
    withEstablishedSession("reloader", fingerprint);

    deliverTag("reloader", init);

    expect(sessionOf("reloader")?.status).toBe("negotiating");
  });
});

// The disconnect handler and the user's End encryption used to call the same
// action. One dropped socket then cleared every pin's auto-resume, which turned
// the feature off for good.
describe("a dropped connection is not the user ending encryption", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("a transport drop leaves the conversation set to re-encrypt", () => {
    const { fingerprint } = peerOffer("dropped");
    obbyPeerTrust.pin(serverId, "dropped", fingerprint);

    dropE2EESessionForDisconnect(serverId, "dropped");

    expect(obbyPeerTrust.shouldAutoResume(serverId, "dropped")).toBe(true);
    expect(sessionOf("dropped")?.status ?? "none").toBe("none");
  });

  test("the user ending it does clear that", () => {
    const { fingerprint } = peerOffer("ended");
    obbyPeerTrust.pin(serverId, "ended", fingerprint);

    resetE2EESession(serverId, "ended");

    expect(obbyPeerTrust.shouldAutoResume(serverId, "ended")).toBe(false);
  });
});

// An offer opens a PM thread, so without this check any nick on the network can
// put an unread row in the sidebar of someone who ignored them.
describe("the ignore list covers encryption offers", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    useStore.setState({
      globalSettings: {
        ...useStore.getState().globalSettings,
        ignoreList: ["pest!*@*"],
      },
    });
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("an ignored nick's offer opens no conversation", () => {
    const { init } = peerOffer("pest");

    deliverTag("pest", init);

    expect(privateChatNames()).not.toContain("pest");
    expect(sessionOf("pest")).toBeUndefined();
  });
});

// An accept only completes against an outstanding offer of our own. If both
// sides drop their own offer to answer the other's, both answers are discarded
// and neither session ever completes. Exactly one side has to stay initiator.
describe("crossing offers settle on one initiator", () => {
  const lower = "0738 A3A7 BF2E 42FC";
  const higher = "F1C2 0000 0000 0000";

  test("the lower fingerprint keeps its own offer", () => {
    expect(keepsOwnOffer(lower, higher)).toBe(true);
  });

  test("the higher fingerprint answers", () => {
    expect(keepsOwnOffer(higher, lower)).toBe(false);
  });

  // Whichever pair it is given, exactly one of the two sides holds. Both
  // holding is the deadlock; both answering discards both accepts.
  test("exactly one side of any pair holds", () => {
    for (const [a, b] of [
      [lower, higher],
      ["AAAA", "BBBB"],
      ["ZZZZ", "AAAA"],
      ["0000 1111", "0000 2222"],
    ]) {
      expect(keepsOwnOffer(a, b)).not.toBe(keepsOwnOffer(b, a));
    }
  });

  // Holding is what sustains a deadlock, so an offer we could not read is
  // answered rather than held.
  test("an unreadable fingerprint is answered, not held", () => {
    expect(keepsOwnOffer(lower, "")).toBe(false);
    expect(keepsOwnOffer("", "")).toBe(false);
  });
});

// The side that re-offers must stop claiming to be encrypted: its keys are the
// ones that stopped working, so its lock has to drop before it sends anything.
describe("re-offering drops the lock", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("a live session goes back to negotiating rather than staying green", () => {
    const { fingerprint } = peerOffer("peer");
    obbyPeerTrust.pin(serverId, "peer", fingerprint);
    useStore.setState({
      e2eeSessions: {
        [`${serverId}:peer`]: {
          status: "established",
          scheme: "obby",
          verified: false,
          peerFingerprint: fingerprint,
        },
      },
    });

    startE2EESession(serverId, "peer");

    expect(sessionOf("peer")?.status).toBe("negotiating");
  });
});

// A handshake completing says nothing about whether it fixed anything. When a
// session establishes and still cannot decrypt, one re-offer is the budget.
describe("a session that cannot decrypt re-offers once", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    sent = [];
    vi.spyOn(ircClient, "sendRaw").mockImplementation((_id, line) => {
      sent.push(line);
    });
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  test("repeated unreadable messages do not each start a handshake", () => {
    const { fingerprint } = peerOffer("looper");
    obbyPeerTrust.pin(serverId, "looper", fingerprint);

    const frame = encodeE2EEPayload({
      t: "msg",
      v: PROTOCOL_VERSION,
      ct: "not-openable",
    });
    const deliver = (id: string) =>
      handleInboundObby(
        serverId,
        "looper",
        undefined,
        `${E2EE_BODY_PREFIX}${frame}`,
        id,
      );

    deliver("m1");
    // One offer, so a regression that stops re-offering altogether fails here
    // rather than passing the no-growth check below.
    const offers = () =>
      sent.filter((l) => l.startsWith(`@${E2EE_TAG}=`)).length;
    expect(offers()).toBe(1);

    deliver("m2");
    deliver("m3");

    expect(offers()).toBe(1);
    // The thread still shows something arrived, so it never looks like the peer
    // simply went quiet. The exact count is not asserted: addMessage collapses
    // same-content rows sharing a millisecond, which these do.
    expect(
      messagesWith("looper").filter(isUndecryptableMessage).length,
    ).toBeGreaterThan(0);
  });
});

// A decrypted message never passes the inbound PRIVMSG handler, so the unread
// count, the sound and the browser notification have to be driven from the
// injection path. Without that an encrypted conversation goes unread and
// unannounced while a plaintext one does not.
describe("an encrypted message counts as unread like any other", () => {
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", workingLocalStorage);
    seedServer();
    vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    vi.spyOn(ircClient, "getNick").mockReturnValue("self");
    registerE2EEHandlers(useStore);
  });

  function chatWith(nick: string) {
    return useStore
      .getState()
      .servers.find((s) => s.id === serverId)
      ?.privateChats?.find((p) => p.username === nick);
  }

  test("a message from the peer bumps the conversation's unread count", () => {
    injectMessage(serverId, "peer", "peer", "you there?");

    expect(chatWith("peer")?.unreadCount).toBe(1);
    expect(chatWith("peer")?.isMentioned).toBe(true);
  });

  test("an encrypted attachment counts too", () => {
    injectMediaMessage(serverId, "sender", "sender", {
      url: "https://host/x.obb",
      k: "",
      n: "",
      mime: "image/png",
      name: "x.png",
      size: 10,
    });

    expect(chatWith("sender")?.unreadCount).toBe(1);
  });

  test("our own echo is not an arrival", () => {
    injectMessage(serverId, "peer2", "self", "sent from here");

    expect(chatWith("peer2")?.unreadCount).toBe(0);
  });
});
