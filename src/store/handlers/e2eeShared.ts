// Orchestration plumbing shared by both E2EE backends (Obby-native over TAGMSG
// and OTR over the PRIVMSG body): the store handle, the per-conversation session
// dispatch, chat-row injection for decrypted messages, and the negotiation
// timeout. Keeping this scheme-agnostic lets the two backends drive the same
// session reducer and the same lock/banner UI.

import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import {
  encodeMediaDescriptor,
  type MediaDescriptor,
} from "../../lib/e2ee/media";
import {
  E2EE_MEDIA_TAG,
  E2EE_NOTICE_TAG,
  E2EE_SESSION_TAG,
  E2EE_UNDECRYPTABLE_TAG,
} from "../../lib/e2ee/messageFlags";
import type { PeerTrustStore } from "../../lib/e2ee/peerTrust";
import {
  type E2EEEvent,
  e2eeSessionKey,
  INITIAL_SESSION,
  reduceSession,
} from "../../lib/e2ee/session";
import type { AppState } from "../index";

// Give up on an unanswered handshake rather than spinning forever: the peer may
// be offline, a client without the scheme, or on a server that strips the tags.
// Obby-native negotiates in one round-trip; OTR's multi-round AKE against
// flood-throttled clients (libotr/irssi pace fragments ~6s apart) needs far more.
export const NEGOTIATION_TIMEOUT_MS = 20_000;
export const OTR_NEGOTIATION_TIMEOUT_MS = 90_000;

let storeRef: StoreApi<AppState> | null = null;

export function setStore(store: StoreApi<AppState>): void {
  storeRef = store;
}

export function getStore(): StoreApi<AppState> | null {
  return storeRef;
}

export const convKey = e2eeSessionKey;

export function dispatch(
  serverId: string,
  nick: string,
  event: E2EEEvent,
): void {
  if (!storeRef) return;
  const key = convKey(serverId, nick);
  storeRef.setState((state) => ({
    e2eeSessions: {
      ...state.e2eeSessions,
      [key]: reduceSession(state.e2eeSessions[key] ?? INITIAL_SESSION, event),
    },
  }));
}

// A control frame can be the first thing a peer ever sends, and every E2EE
// affordance renders inside the PM thread, so the thread has to exist before
// the session state that drives it.
export function ensurePrivateChat(serverId: string, chatNick: string): void {
  ensureChat(serverId, chatNick);
}

function ensureChat(serverId: string, chatNick: string) {
  if (!storeRef) return undefined;
  const findChat = () =>
    storeRef
      ?.getState()
      .servers.find((s) => s.id === serverId)
      ?.privateChats?.find(
        (p) => p.username.toLowerCase() === chatNick.toLowerCase(),
      );
  let chat = findChat();
  if (!chat) {
    storeRef.getState().openPrivateChat(serverId, chatNick);
    chat = findChat();
  }
  return chat;
}

// Render a message in the PM thread with `chatNick`, authored by `author` (the
// peer for inbound, ourselves for the local echo of an outgoing message). Used
// by both backends since the plaintext never touches the chat view directly.
// `msgid` is the carrying PRIVMSG's id (Obby only), adopted so replies,
// reactions, and redaction reference the real IRC message.
export function injectMessage(
  serverId: string,
  chatNick: string,
  author: string,
  content: string,
  msgid?: string,
): void {
  const chat = ensureChat(serverId, chatNick);
  if (!chat) return;
  storeRef?.getState().addMessage({
    id: uuidv4(),
    msgid,
    content,
    timestamp: new Date(),
    userId: author,
    channelId: chat.id,
    serverId,
    type: "message",
    reactions: [],
    mentioned: [],
    replyMessage: null,
    // The text was protected in transit, which is not the same as a file it
    // links to having been; the renderer needs to be able to say so.
    tags: { [E2EE_SESSION_TAG]: "1" },
  });
}

// Stand in for ciphertext this client cannot open: a peer encrypting to a
// session we no longer hold, or a ratchet that lost step. Dropping it silently
// would read as the peer having gone quiet, which is the one thing the user
// must not conclude.
export function injectUndecryptable(
  serverId: string,
  chatNick: string,
  author: string,
  msgid?: string,
): void {
  const chat = ensureChat(serverId, chatNick);
  if (!chat) return;
  storeRef?.getState().addMessage({
    id: uuidv4(),
    msgid,
    content: "",
    timestamp: new Date(),
    userId: author,
    channelId: chat.id,
    serverId,
    type: "message",
    reactions: [],
    mentioned: [],
    replyMessage: null,
    tags: { [E2EE_UNDECRYPTABLE_TAG]: "1" },
  });
}

// Render an attachment row. The descriptor rides in the message tags, so the
// visible content is only the caption and the file's URL never becomes text.
export function injectMediaMessage(
  serverId: string,
  chatNick: string,
  author: string,
  descriptor: MediaDescriptor,
  msgid?: string,
): void {
  const chat = ensureChat(serverId, chatNick);
  if (!chat) return;
  storeRef?.getState().addMessage({
    id: uuidv4(),
    msgid,
    content: descriptor.caption ?? "",
    timestamp: new Date(),
    userId: author,
    channelId: chat.id,
    serverId,
    type: "message",
    reactions: [],
    mentioned: [],
    replyMessage: null,
    tags: { [E2EE_MEDIA_TAG]: encodeMediaDescriptor(descriptor) },
  });
}

// Inject an advisory row into the PM thread, rendered distinctly from chat
// content so an encryption warning can't be mistaken for a normal message.
export function injectSystemNotice(
  serverId: string,
  chatNick: string,
  content: string,
  timestamp: Date = new Date(),
): void {
  const chat = ensureChat(serverId, chatNick);
  if (!chat) return;
  storeRef?.getState().addMessage({
    id: uuidv4(),
    content,
    timestamp,
    userId: "system",
    channelId: chat.id,
    serverId,
    type: "system",
    reactions: [],
    mentioned: [],
    replyMessage: null,
    tags: { [E2EE_NOTICE_TAG]: "warning" },
  });
}

const negotiationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearNegotiationTimer(key: string): void {
  const timer = negotiationTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    negotiationTimers.delete(key);
  }
}

// Fail a stalled handshake. `onTimeout` lets each backend tear down its own
// session state; the shared error dispatch then surfaces it in the UI.
export function armNegotiationTimer(
  serverId: string,
  nick: string,
  onTimeout: () => void,
  timeoutMs: number = NEGOTIATION_TIMEOUT_MS,
): void {
  const key = convKey(serverId, nick);
  clearNegotiationTimer(key);
  negotiationTimers.set(
    key,
    setTimeout(() => {
      negotiationTimers.delete(key);
      if (storeRef?.getState().e2eeSessions[key]?.status !== "negotiating")
        return;
      onTimeout();
      dispatch(serverId, nick, { type: "error", reason: "no-response" });
    }, timeoutMs),
  );
}

// Apply TOFU on an established session: pin the peer's fingerprint, warn on a
// change, and re-flag a previously-verified peer as verified. Call after the
// session reaches "established"; identical for both schemes, only the trust
// store differs.
//
// A changed key is reported and left unpinned. Pinning it here would clear the
// warning after one showing, so the next handshake against the same substituted
// key would read as unchanged and show a plain green lock. The pin moves only
// when the user accepts it (see trustChangedKey).
export function reconcilePeerTrust(
  trust: PeerTrustStore,
  serverId: string,
  nick: string,
  fingerprint: string,
): void {
  const before = trust.get(serverId, nick);
  const status = trust.pin(serverId, nick, fingerprint);
  if (status === "changed") {
    dispatch(serverId, nick, {
      type: "key-change",
      oldFingerprint: before?.fingerprint ?? "",
      newFingerprint: fingerprint,
    });
  } else if (status === "same" && before?.verified) {
    dispatch(serverId, nick, { type: "verify" });
  }
}

// The user looked at the new fingerprint and accepted it, so the pin moves and
// the session continues under the new key.
export function trustChangedKey(
  trust: PeerTrustStore,
  serverId: string,
  nick: string,
): void {
  const session = getStore()?.getState().e2eeSessions[convKey(serverId, nick)];
  if (session?.status !== "key-changed") return;
  trust.repin(serverId, nick, session.newFingerprint);
  dispatch(serverId, nick, { type: "trust-key" });
}
