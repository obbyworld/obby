// Orchestration plumbing shared by both E2EE backends (Obby-native over TAGMSG
// and OTR over the PRIVMSG body): the store handle, the per-conversation session
// dispatch, chat-row injection for decrypted messages, and the negotiation
// timeout. Keeping this scheme-agnostic lets the two backends drive the same
// session reducer and the same lock/banner UI.

import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { PeerTrustStore } from "../../lib/e2ee/peerTrust";
import {
  type E2EEEvent,
  e2eeSessionKey,
  INITIAL_SESSION,
  reduceSession,
} from "../../lib/e2ee/session";
import type { AppState } from "../index";

// Give up on an unanswered handshake rather than spinning forever — the peer may
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

// Render a message in the PM thread with `chatNick`, authored by `author` (the
// peer for inbound, ourselves for the local echo of an outgoing message). Used
// by both backends since the ciphertext rides on a channel the chat view never
// sees, so the plaintext has to be injected here.
export function injectMessage(
  serverId: string,
  chatNick: string,
  author: string,
  content: string,
): void {
  if (!storeRef) return;
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
  if (!chat) return;
  storeRef.getState().addMessage({
    id: uuidv4(),
    content,
    timestamp: new Date(),
    userId: author,
    channelId: chat.id,
    serverId,
    type: "message",
    reactions: [],
    mentioned: [],
    replyMessage: null,
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
      dispatch(serverId, nick, {
        type: "error",
        reason: "no response from peer",
      });
    }, timeoutMs),
  );
}

// Apply TOFU on an established session: pin the peer's fingerprint, warn on a
// change (then trust-on-use so a re-handshake doesn't loop), and re-flag a
// previously-verified peer as verified. Call after the session reaches
// "established"; identical for both schemes, only the trust store differs.
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
    trust.repin(serverId, nick, fingerprint);
  } else if (status === "same" && before?.verified) {
    dispatch(serverId, nick, { type: "verify" });
  }
}
