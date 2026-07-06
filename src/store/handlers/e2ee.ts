// Obby-native PM E2EE orchestration: owns the Obby crypto backend and reflects
// each conversation's lifecycle into the shared session reducer (see e2eeShared).
// Handshake/control frames ride an invisible TAGMSG client tag (handled here);
// message payloads ride the PRIVMSG body and are diverted by handleInboundObby
// (called by the USERMSG handler, like OTR) so the decrypted row keeps the real
// msgid for replies/reactions. The OTR interop backend lives alongside in otr.ts
// and shares the same plumbing.

import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { ObbyE2EEBackend, type PeerRef } from "../../lib/e2ee/backend";
import { classifyInbound } from "../../lib/e2ee/classify";
import { getObbyIdentity, obbyPeerTrust } from "../../lib/e2ee/obbyIdentity";
import {
  bodyToRaw,
  decodeE2EEPayload,
  E2EE_BODY_PREFIX,
  E2EE_TAG,
  type E2EEAccept,
  type E2EEInit,
  type E2EEPayload,
  MAX_BODY_FRAGMENT_SLICE,
  MAX_BODY_VALUE_BYTES,
  MAX_TAG_FRAGMENT_SLICE,
  MAX_TAG_VALUE_BYTES,
  PROTOCOL_VERSION,
} from "../../lib/e2ee/protocol";
import { FragmentReassembler, frameValues } from "../../lib/e2ee/transport";
import ircClient from "../../lib/ircClient";
import type { AppState } from "../index";
import {
  armNegotiationTimer,
  clearNegotiationTimer,
  convKey,
  dispatch,
  getStore,
  injectMessage,
  reconcilePeerTrust,
  setStore,
} from "./e2eeShared";

const backend = new ObbyE2EEBackend(getObbyIdentity());
const reassembler = new FragmentReassembler();
// Inbound offers held until the user accepts, so acceptOffer can consume the
// original bundle rather than re-deriving it.
const pendingOffers = new Map<string, E2EEInit>();

// The initiator's first encrypted payload after completing the handshake. Its
// arrival is how the responder learns the initiator can decrypt, so it only
// shows the session as established once it's confirmed. Never rendered.
const HANDSHAKE_ACK = `${String.fromCharCode(0)}obby-e2ee-handshake-ack`;

// Control frames (init/accept/reject/ack) ride the tag on a bodiless TAGMSG, so
// the payload is the tag value. Message payloads ride the PRIVMSG body — behind
// the marker (the reliable signal, since the tag may be stripped there) and the
// flag tag (idiomatic where relayed) — keeping a real msgid. The ack is a
// `msg`-shaped cipher but is handshake control, so its call site sends it over
// the tag.
function send(
  serverId: string,
  target: string,
  payload: E2EEPayload,
  viaTag: boolean,
): void {
  const id = uuidv4();
  const values = viaTag
    ? frameValues(payload, id, MAX_TAG_VALUE_BYTES, MAX_TAG_FRAGMENT_SLICE)
    : frameValues(payload, id, MAX_BODY_VALUE_BYTES, MAX_BODY_FRAGMENT_SLICE);
  for (const value of values) {
    ircClient.sendRaw(
      serverId,
      viaTag
        ? `@${E2EE_TAG}=${value} TAGMSG ${target}`
        : `@${E2EE_TAG} PRIVMSG ${target} :${E2EE_BODY_PREFIX}${value}`,
    );
  }
}

// Decode a raw carrier value (a TAGMSG tag value or a marker-stripped PRIVMSG
// body) and drive the completed payload, reassembling across calls when it
// arrived fragmented. Shared by both carriers so the fragment handling can't
// drift between them.
function dispatchDecoded(
  serverId: string,
  sender: string,
  raw: string,
  msgid?: string,
): void {
  const payload = decodeE2EEPayload(raw);
  if (!payload) return;
  if (payload.t === "frag") {
    const value = reassembler.add(payload);
    if (!value) return;
    const reassembled = decodeE2EEPayload(value);
    if (reassembled && reassembled.t !== "frag")
      onPayload(serverId, sender, reassembled, msgid);
    return;
  }
  onPayload(serverId, sender, payload, msgid);
}

function onPayload(
  serverId: string,
  sender: string,
  payload: E2EEPayload,
  msgid?: string,
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
      // A duplicate or replayed accept arriving after we already completed (the
      // pending handshake is consumed once) must not tear down the live session.
      if (!backend.hasPending(peer)) return;
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
      reconcilePeerTrust(
        obbyPeerTrust,
        serverId,
        sender,
        backend.peerFingerprint(peer) ?? "",
      );
      try {
        send(serverId, sender, backend.encrypt(peer, HANDSHAKE_ACK), true);
      } catch {
        // Session is live; a failed ack only delays the peer's confirmation.
      }
      return;
    case "reject":
      clearNegotiationTimer(convKey(serverId, sender));
      dispatch(serverId, sender, { type: "rejected-remote" });
      return;
    case "msg": {
      if (!backend.hasSession(peer)) return;
      let text: string;
      try {
        text = backend.decrypt(peer, payload);
      } catch {
        // A forged or out-of-session ciphertext can't decrypt; drop it rather
        // than surfacing noise. The session state is left intact (see ratchet).
        return;
      }
      const key = convKey(serverId, sender);
      if (getStore()?.getState().e2eeSessions[key]?.status === "negotiating") {
        clearNegotiationTimer(key);
        dispatch(serverId, sender, {
          type: "accepted-remote",
          peerFingerprint: backend.peerFingerprint(peer) ?? "",
        });
        reconcilePeerTrust(
          obbyPeerTrust,
          serverId,
          sender,
          backend.peerFingerprint(peer) ?? "",
        );
      }
      if (text === HANDSHAKE_ACK) return;
      injectMessage(serverId, sender, sender, text, msgid);
      return;
    }
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
  setStore(store);
  store.setState({ e2eeSelfFingerprint: backend.selfFingerprint() });

  // Handshake/control frames arrive here on the invisible TAGMSG tag (message
  // payloads instead come through handleInboundObby with a real msgid).
  ircClient.on("TAGMSG", ({ serverId, mtags, sender }) => {
    const raw = mtags?.[E2EE_TAG];
    if (raw === undefined) return;
    // echo-message reflects our own control frames back; processing them spawns
    // phantom self-sessions. CHATHISTORY (batch) replays must not drive state.
    const self = ircClient.getNick(serverId);
    if (self && sender.toLowerCase() === self.toLowerCase()) return;
    if (mtags?.batch !== undefined) return;
    dispatchDecoded(serverId, sender, raw);
  });
}

// Returns true when the PRIVMSG body carries the Obby ciphertext marker, so the
// USERMSG handler consumes it instead of rendering the encoded body.
// `skipProcessing` swallows the frame without driving the session — for our own
// echoed sends (echo-message) and CHATHISTORY replays, which must not clobber
// live session state. `msgid` is the carrying PRIVMSG's id, adopted by the
// decrypted row so replies/reactions target the real message.
export function handleInboundObby(
  serverId: string,
  sender: string,
  mtags: Record<string, string> | undefined,
  body: string,
  msgid?: string,
  skipProcessing = false,
): boolean {
  if (classifyInbound({ mtags, body }).scheme !== "obby") return false;
  if (skipProcessing) return true;
  const raw = bodyToRaw(body);
  if (raw !== null) dispatchDecoded(serverId, sender, raw, msgid);
  return true;
}

export function startE2EESession(serverId: string, nick: string): void {
  send(serverId, nick, backend.startSession({ serverId, nick }), true);
  dispatch(serverId, nick, { type: "start", scheme: "obby" });
  armNegotiationTimer(serverId, nick, () => backend.reset({ serverId, nick }));
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
  send(serverId, nick, accept, true);
  // Stay negotiating until the initiator's first encrypted payload confirms it
  // received the accept; establishing here would show a false green if it didn't.
  dispatch(serverId, nick, { type: "accept-local" });
  armNegotiationTimer(serverId, nick, () => backend.reset({ serverId, nick }));
}

export function rejectE2EEOffer(serverId: string, nick: string): void {
  pendingOffers.delete(convKey(serverId, nick));
  send(serverId, nick, { t: "reject", v: PROTOCOL_VERSION }, true);
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
  obbyPeerTrust.setVerified(serverId, nick);
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
  send(serverId, nick, backend.encrypt(peer, content), false);
  const store = getStore();
  if (!store) return;
  const self = store.getState().currentUser?.username ?? "";
  injectMessage(serverId, nick, self, content);
}
