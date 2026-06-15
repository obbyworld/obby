// Obby-native PM E2EE orchestration: owns the single crypto backend, drives the
// handshake over invisible TAGMSG client-only tags, and reflects each
// conversation's lifecycle into the store (via the session reducer) for the
// lock UI. Inbound encrypted messages are decrypted and injected as normal chat
// rows; outbound ones are encrypted here instead of being sent as plaintext.

import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { ObbyE2EEBackend, type PeerRef } from "../../lib/e2ee/backend";
import { classifyInbound } from "../../lib/e2ee/classify";
import {
  decodeE2EEPayload,
  type E2EEAccept,
  type E2EEInit,
  type E2EEPayload,
} from "../../lib/e2ee/protocol";
import {
  type E2EEEvent,
  INITIAL_SESSION,
  reduceSession,
} from "../../lib/e2ee/session";
import { FragmentReassembler, framePayload } from "../../lib/e2ee/transport";
import ircClient from "../../lib/ircClient";
import type { AppState } from "../index";

// Give up on an unanswered handshake rather than spinning forever — the peer
// may be offline, a non-Obby client, or on a server that strips the tags.
const NEGOTIATION_TIMEOUT_MS = 20_000;

const backend = new ObbyE2EEBackend();
const reassembler = new FragmentReassembler();
// Inbound offers held until the user accepts, so acceptOffer can consume the
// original bundle rather than re-deriving it.
const pendingOffers = new Map<string, E2EEInit>();
const negotiationTimers = new Map<string, ReturnType<typeof setTimeout>>();

let storeRef: StoreApi<AppState> | null = null;

function clearNegotiationTimer(key: string): void {
  const timer = negotiationTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    negotiationTimers.delete(key);
  }
}

function armNegotiationTimer(serverId: string, nick: string): void {
  const key = convKey(serverId, nick);
  clearNegotiationTimer(key);
  negotiationTimers.set(
    key,
    setTimeout(() => {
      negotiationTimers.delete(key);
      if (storeRef?.getState().e2eeSessions[key]?.status !== "negotiating")
        return;
      backend.reset({ serverId, nick });
      dispatch(serverId, nick, {
        type: "error",
        reason: "no response from peer",
      });
    }, NEGOTIATION_TIMEOUT_MS),
  );
}

function convKey(serverId: string, nick: string): string {
  return `${serverId}:${nick.toLowerCase()}`;
}

function dispatch(serverId: string, nick: string, event: E2EEEvent): void {
  if (!storeRef) return;
  const key = convKey(serverId, nick);
  storeRef.setState((state) => ({
    e2eeSessions: {
      ...state.e2eeSessions,
      [key]: reduceSession(state.e2eeSessions[key] ?? INITIAL_SESSION, event),
    },
  }));
}

function send(serverId: string, target: string, payload: E2EEPayload): void {
  for (const line of framePayload(payload, target, uuidv4())) {
    ircClient.sendRaw(serverId, line);
  }
}

// Render a message in the PM thread with `chatNick`, authored by `author`
// (the peer for inbound, ourselves for the local echo of an outgoing message).
function injectMessage(
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

function onPayload(
  serverId: string,
  sender: string,
  payload: E2EEPayload,
): void {
  const peer: PeerRef = { serverId, nick: sender };
  switch (payload.t) {
    case "init":
      pendingOffers.set(convKey(serverId, sender), payload);
      dispatch(serverId, sender, {
        type: "offer-received",
        scheme: "obby",
        peerFingerprint: safeFingerprint(payload),
      });
      return;
    case "accept":
      clearNegotiationTimer(convKey(serverId, sender));
      try {
        backend.completeSession(peer, payload);
      } catch {
        dispatch(serverId, sender, {
          type: "error",
          reason: "handshake failed",
        });
        return;
      }
      dispatch(serverId, sender, {
        type: "accepted-remote",
        peerFingerprint: backend.peerFingerprint(peer) ?? "",
      });
      return;
    case "reject":
      clearNegotiationTimer(convKey(serverId, sender));
      dispatch(serverId, sender, { type: "rejected-remote" });
      return;
    case "msg":
      if (!backend.hasSession(peer)) return;
      try {
        injectMessage(serverId, sender, sender, backend.decrypt(peer, payload));
      } catch {
        // A forged or out-of-session ciphertext can't decrypt; drop it rather
        // than surfacing noise. The session state is left intact (see ratchet).
      }
      return;
  }
}

function safeFingerprint(payload: E2EEInit | E2EEAccept): string {
  try {
    return backend.offeredFingerprint(payload);
  } catch {
    return "";
  }
}

export function registerE2EEHandlers(store: StoreApi<AppState>): void {
  storeRef = store;
  store.setState({ e2eeSelfFingerprint: backend.selfFingerprint() });

  ircClient.on("TAGMSG", ({ serverId, mtags, sender }) => {
    const classified = classifyInbound({ mtags });
    if (classified.scheme !== "obby") return;
    const raw = mtags?.[classified.tag];
    if (!raw) return;
    const payload = decodeE2EEPayload(raw);
    if (!payload) return;
    if (payload.t === "frag") {
      const value = reassembler.add(payload);
      if (!value) return;
      const reassembled = decodeE2EEPayload(value);
      if (reassembled && reassembled.t !== "frag")
        onPayload(serverId, sender, reassembled);
      return;
    }
    onPayload(serverId, sender, payload);
  });
}

export function startE2EESession(serverId: string, nick: string): void {
  send(serverId, nick, backend.startSession({ serverId, nick }));
  dispatch(serverId, nick, { type: "start", scheme: "obby" });
  armNegotiationTimer(serverId, nick);
}

export function acceptE2EEOffer(serverId: string, nick: string): void {
  const key = convKey(serverId, nick);
  const offer = pendingOffers.get(key);
  if (!offer) return;
  pendingOffers.delete(key);
  const peer: PeerRef = { serverId, nick };
  let accept: E2EEAccept;
  try {
    accept = backend.acceptOffer(peer, offer);
  } catch {
    dispatch(serverId, nick, { type: "error", reason: "handshake failed" });
    return;
  }
  send(serverId, nick, accept);
  dispatch(serverId, nick, { type: "accept-local" });
  dispatch(serverId, nick, { type: "established" });
}

export function rejectE2EEOffer(serverId: string, nick: string): void {
  pendingOffers.delete(convKey(serverId, nick));
  send(serverId, nick, { t: "reject", v: 1 });
  dispatch(serverId, nick, { type: "reject-local" });
}

export function resetE2EESession(serverId: string, nick: string): void {
  const key = convKey(serverId, nick);
  clearNegotiationTimer(key);
  backend.reset({ serverId, nick });
  pendingOffers.delete(key);
  dispatch(serverId, nick, { type: "reset" });
}

export function verifyE2EESession(serverId: string, nick: string): void {
  dispatch(serverId, nick, { type: "verify" });
}

// Encrypt and send an outgoing PM, echoing the plaintext locally since the
// ciphertext rides on an invisible TAGMSG the sender won't otherwise see.
export function sendEncryptedMessage(
  serverId: string,
  nick: string,
  content: string,
): void {
  const peer: PeerRef = { serverId, nick };
  if (!backend.hasSession(peer)) return;
  send(serverId, nick, backend.encrypt(peer, content));
  if (!storeRef) return;
  const self = storeRef.getState().currentUser?.username ?? "";
  injectMessage(serverId, nick, self, content);
}

export function isE2EEActive(serverId: string, nick: string): boolean {
  return backend.hasSession({ serverId, nick });
}

export function e2eePeerFingerprint(
  serverId: string,
  nick: string,
): string | null {
  return backend.peerFingerprint({ serverId, nick });
}
