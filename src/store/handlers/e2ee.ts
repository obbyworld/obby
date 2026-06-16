// Obby-native PM E2EE orchestration: owns the Obby crypto backend and drives the
// handshake over invisible TAGMSG client-only tags, reflecting each
// conversation's lifecycle into the shared session reducer (see e2eeShared).
// Inbound encrypted messages are decrypted and injected as normal chat rows;
// outbound ones are encrypted here instead of being sent as plaintext. The OTR
// interop backend lives alongside in otr.ts and shares the same plumbing.

import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { ObbyE2EEBackend, type PeerRef } from "../../lib/e2ee/backend";
import { classifyInbound } from "../../lib/e2ee/classify";
import { getObbyIdentity, obbyPeerTrust } from "../../lib/e2ee/obbyIdentity";
import {
  decodeE2EEPayload,
  type E2EEAccept,
  type E2EEInit,
  type E2EEPayload,
} from "../../lib/e2ee/protocol";
import { FragmentReassembler, framePayload } from "../../lib/e2ee/transport";
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

function send(serverId: string, target: string, payload: E2EEPayload): void {
  for (const line of framePayload(payload, target, uuidv4())) {
    ircClient.sendRaw(serverId, line);
  }
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
      reconcilePeerTrust(
        obbyPeerTrust,
        serverId,
        sender,
        backend.peerFingerprint(peer) ?? "",
      );
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
  setStore(store);
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
  send(serverId, nick, accept);
  dispatch(serverId, nick, { type: "accept-local" });
  dispatch(serverId, nick, { type: "established" });
  reconcilePeerTrust(
    obbyPeerTrust,
    serverId,
    nick,
    backend.peerFingerprint(peer) ?? "",
  );
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
  send(serverId, nick, backend.encrypt(peer, content));
  const store = getStore();
  if (!store) return;
  const self = store.getState().currentUser?.username ?? "";
  injectMessage(serverId, nick, self, content);
}
