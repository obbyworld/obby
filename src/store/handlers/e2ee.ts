// Obby-native PM E2EE orchestration: owns the Obby crypto backend and reflects
// each conversation's lifecycle into the session reducer (see e2eeConversation).
// Handshake/control frames ride an invisible TAGMSG client tag (handled here);
// message payloads ride the PRIVMSG body and are diverted by handleInboundObby
// (called by the USERMSG handler, like OTR) so the decrypted row keeps the real
// msgid for replies/reactions. The OTR interop backend lives alongside in otr.ts
// and shares the same plumbing.

import { t } from "@lingui/core/macro";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { ObbyE2EEBackend, type PeerRef } from "../../lib/e2ee/backend";
import { classifyInbound } from "../../lib/e2ee/classify";
import {
  decodeMediaDescriptor,
  encodeMediaDescriptor,
  type MediaDescriptor,
} from "../../lib/e2ee/media";
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
  privmsgTagValue,
  readPayloadVersion,
} from "../../lib/e2ee/protocol";
import { expectsProtection } from "../../lib/e2ee/session";
import { FragmentReassembler, frameValues } from "../../lib/e2ee/transport";
import { isUserIgnored } from "../../lib/ignoreUtils";
import ircClient from "../../lib/ircClient";
import { makeLabel, shouldUseLabeledResponse } from "../../lib/labeledResponse";
import type { AppState } from "../index";
import {
  armNegotiationTimer,
  type CarriedMessageRef,
  clearNegotiationTimer,
  convKey,
  dispatch,
  ensurePrivateChat,
  getStore,
  injectMediaMessage,
  injectMessage,
  injectSystemNotice,
  injectUndecryptable,
  noteSessionEstablished,
  reconcilePeerTrust,
  setStore,
  trustChangedKey,
} from "./e2eeConversation";

const backend = new ObbyE2EEBackend(getObbyIdentity());
const reassembler = new FragmentReassembler();
// Inbound offers held until the user accepts, so acceptOffer can consume the
// original bundle rather than re-deriving it.
const pendingOffers = new Map<string, E2EEInit>();

// Conversations already told that ciphertext arrived with no session, so a peer
// still encrypting to a torn-down session produces one notice, not one per
// message.
const orphanCiphertextWarned = new Set<string>();

// Conversations already answered with a version rejection, so two clients on
// versions neither can read exchange one frame rather than an endless pair.
const versionRejected = new Set<string>();

// Conversations we already re-offered encryption to since the last successful
// decrypt. Ratchet state is memory-only, so a peer that reloads leaves the
// other side holding keys nothing can open; one re-offer recovers it, and the
// latch stops a peer that keeps failing from turning into a handshake loop.
const resumeOffered = new Set<string>();

// Control frames (init/accept/reject/ack/close) ride the tag on a bodiless
// TAGMSG, so the payload is the tag value. Message payloads ride the PRIVMSG
// body behind the marker, keeping a real msgid, and carry the tag as a hint for
// anything inspecting the wire. The tag value is the protocol version: a tag
// relay may require a non-empty value (ours does), so a valueless flag is
// dropped before it reaches the peer.
function send(
  serverId: string,
  target: string,
  payload: E2EEPayload,
  viaTag: boolean,
  carrier: CarriedMessageRef = {},
): void {
  const id = uuidv4();
  const values = viaTag
    ? frameValues(payload, id, MAX_TAG_VALUE_BYTES, MAX_TAG_FRAGMENT_SLICE)
    : frameValues(payload, id, MAX_BODY_VALUE_BYTES, MAX_BODY_FRAGMENT_SLICE);
  const bodyTag = privmsgTagValue(payload.t === "media" ? "media" : "msg");
  values.forEach((value, index) => {
    if (viaTag) {
      ircClient.sendRaw(serverId, `@${E2EE_TAG}=${value} TAGMSG ${target}`);
      return;
    }
    const tags = [`${E2EE_TAG}=${bodyTag}`];
    // The receiver reads a fragmented payload on the frame that completes it,
    // so the message's identity is the last frame's. Naming it on an earlier
    // one would leave the two sides replying to different msgids.
    if (index === values.length - 1) {
      if (carrier.replyTo) {
        tags.push(
          `+reply=${carrier.replyTo}`,
          `+draft/reply=${carrier.replyTo}`,
        );
      }
      if (carrier.label) tags.push(`label=${carrier.label}`);
    }
    ircClient.sendRaw(
      serverId,
      `@${tags.join(";")} PRIVMSG ${target} :${E2EE_BODY_PREFIX}${value}`,
    );
  });
}

// The threading of an encrypted conversation travels in the clear: which
// message answers which is a relation the relay can already see between two
// ciphertexts, and putting it in the carrier's tags is what lets a decrypted
// row use the same reply plumbing as any other message.
function carrierRef(serverId: string, replyTo?: string): CarriedMessageRef {
  return {
    replyTo,
    label: shouldUseLabeledResponse(serverId) ? makeLabel() : undefined,
  };
}

function replyTagOf(
  mtags: Record<string, string> | undefined,
): string | undefined {
  return (mtags?.["+reply"] ?? mtags?.["+draft/reply"])?.trim() || undefined;
}

// Decode a raw carrier value (a TAGMSG tag value or a marker-stripped PRIVMSG
// body) and drive the completed payload, reassembling across calls when it
// arrived fragmented. Shared by both carriers so the fragment handling can't
// drift between them.
function dispatchDecoded(
  serverId: string,
  sender: string,
  raw: string,
  carrier: CarriedMessageRef = {},
): void {
  const payload = decodeE2EEPayload(raw);
  if (!payload) {
    // Decoding fails on a version we don't speak as well as on garbage, so tell
    // the peer when it's the former. A version we can't read includes the reply
    // itself, so answering every such frame would have two clients rejecting
    // each other forever: answer a given conversation once. The session moves
    // to an error only while a handshake is actually outstanding, so an
    // unreadable frame from anyone else can't tear down a live session.
    const version = readPayloadVersion(raw);
    if (version !== null && version !== PROTOCOL_VERSION) {
      const key = convKey(serverId, sender);
      if (!versionRejected.has(key)) {
        versionRejected.add(key);
        send(serverId, sender, { t: "reject", v: PROTOCOL_VERSION }, true);
      }
      if (getStore()?.getState().e2eeSessions[key]?.status === "negotiating") {
        clearNegotiationTimer(key);
        dispatch(serverId, sender, {
          type: "error",
          reason: "unsupported-version",
        });
      }
    }
    return;
  }
  if (payload.t === "frag") {
    const value = reassembler.add(payload);
    if (!value) return;
    const reassembled = decodeE2EEPayload(value);
    if (reassembled && reassembled.t !== "frag")
      onPayload(serverId, sender, reassembled, carrier);
    return;
  }
  onPayload(serverId, sender, payload, carrier);
}

// An accept only completes against an outstanding offer of our own, so two
// offers crossing must not leave both sides answering: both accepts would be
// discarded and neither session would ever complete. The lower fingerprint
// keeps its offer and stays initiator, the other one answers. Fingerprints
// decide it because both sides hold the same pair, and unlike a nick neither
// can change mid-handshake. An offer whose fingerprint did not parse is
// answered rather than held, since holding is what sustains a deadlock.
export function keepsOwnOffer(
  selfFingerprint: string,
  peerFingerprint: string,
): boolean {
  if (peerFingerprint === "") return false;
  return selfFingerprint < peerFingerprint;
}

function onPayload(
  serverId: string,
  sender: string,
  payload: E2EEPayload,
  carrier: CarriedMessageRef = {},
): void {
  const peer: PeerRef = { serverId, nick: sender };
  switch (payload.t) {
    case "init": {
      const key = convKey(serverId, sender);
      const fingerprint = safeFingerprint(payload);

      if (
        backend.hasPending(peer) &&
        keepsOwnOffer(backend.selfFingerprint(), fingerprint)
      ) {
        return;
      }
      // Consent is per peer, not per session: once the user has encrypted with
      // this key, a later offer under the same key needs no second prompt.
      const pinned = obbyPeerTrust.get(serverId, sender);
      const isSameKey = !!fingerprint && pinned?.fingerprint === fingerprint;
      const willAccept = isSameKey && pinned?.autoResume !== false;

      // A live session is replaced only by an offer under the key that built
      // it, and only when that offer is accepted in the same breath. Tearing
      // down first would let one forged frame drop the conversation to a state
      // that sends in the clear, which is the whole thing this protects
      // against: `pending-accept` does not withhold.
      const current = getStore()?.getState().e2eeSessions[key];
      if (expectsProtection(current) && !willAccept) {
        dispatch(
          serverId,
          sender,
          isSameKey
            ? { type: "error", reason: "peer-ended" }
            : {
                type: "key-change",
                oldFingerprint: pinned?.fingerprint ?? "",
                newFingerprint: fingerprint,
              },
        );
        return;
      }

      // A peer that reloaded offers again while we still hold their old session.
      // Those keys can no longer open anything they send, so the offer replaces
      // them. The row reports the peer's action and the state it leaves us in,
      // both of which are known here; which messages crossed the gap is not.
      const wasLive = backend.hasSession(peer);
      backend.reset(peer);
      dispatch(serverId, sender, { type: "reset" });
      if (wasLive) {
        injectSystemNotice(
          serverId,
          sender,
          willAccept
            ? t`${sender} restarted encryption, so this conversation is being set up again.`
            : t`${sender} restarted encryption. This conversation stays unencrypted until you accept.`,
        );
      }
      pendingOffers.set(key, payload);
      ensurePrivateChat(serverId, sender);
      dispatch(serverId, sender, {
        type: "offer-received",
        scheme: "obby",
        peerFingerprint: fingerprint,
      });
      if (willAccept) acceptE2EEOffer(serverId, sender);
      return;
    }
    case "accept":
      clearNegotiationTimer(convKey(serverId, sender));
      // A duplicate or replayed accept arriving after we already completed (the
      // pending handshake is consumed once) must not tear down the live session.
      if (!backend.hasPending(peer)) return;
      try {
        backend.completeSession(peer, payload);
      } catch {
        // completeSession throws before consuming the handshake, and one left
        // outstanding reads as "mid-negotiation" forever, suppressing the
        // peer's later offers.
        backend.reset(peer);
        dispatch(serverId, sender, {
          type: "error",
          reason: "handshake-failed",
        });
        return;
      }
      // A new session gets to report its own problems, so the once-only notices
      // start over.
      forgetConversation(convKey(serverId, sender));
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
      noteSessionEstablished(serverId, sender);
      try {
        send(serverId, sender, backend.encryptAck(peer), true);
      } catch {
        // Session is live; a failed ack only delays the peer's confirmation.
      }
      return;
    case "reject":
      clearNegotiationTimer(convKey(serverId, sender));
      // Our offer is dead, so the handshake goes with it. A handshake left
      // outstanding reads as "mid-negotiation" forever and suppresses the
      // peer's later offers.
      backend.reset(peer);
      dispatch(serverId, sender, { type: "rejected-remote" });
      return;
    case "close": {
      if (!backend.hasSession(peer) && !backend.hasPending(peer)) return;
      const key = convKey(serverId, sender);
      backend.reset(peer);
      pendingOffers.delete(key);
      clearNegotiationTimer(key);
      forgetConversation(key);
      allowResumeAgain(key);
      dispatch(serverId, sender, { type: "error", reason: "peer-ended" });
      return;
    }
    case "ack":
      if (!backend.hasSession(peer)) return;
      try {
        backend.decrypt(peer, payload);
      } catch {
        return;
      }
      noteDecryptSucceeded(serverId, sender, peer);
      return;
    case "msg": {
      if (!backend.hasSession(peer)) {
        handleUnreadable(serverId, sender, carrier.msgid);
        return;
      }
      let text: string;
      try {
        text = backend.decrypt(peer, payload);
      } catch {
        handleUnreadable(serverId, sender, carrier.msgid);
        return;
      }
      noteDecryptSucceeded(serverId, sender, peer);
      injectMessage(serverId, sender, sender, text, carrier);
      return;
    }
    case "media": {
      if (!backend.hasSession(peer)) {
        handleUnreadable(serverId, sender, carrier.msgid);
        return;
      }
      let descriptor: string;
      try {
        descriptor = backend.decrypt(peer, payload);
      } catch {
        handleUnreadable(serverId, sender, carrier.msgid);
        return;
      }
      const media = decodeMediaDescriptor(descriptor);
      if (!media) return;
      noteDecryptSucceeded(serverId, sender, peer);
      injectMediaMessage(serverId, sender, sender, media, carrier);
      return;
    }
  }
}

// Opening a frame is the only evidence encryption actually works, so it is what
// lets the conversation offer a resume again. A completed handshake is not: the
// case this guards is a session that establishes and still cannot decrypt.
function noteDecryptSucceeded(
  serverId: string,
  sender: string,
  peer: PeerRef,
): void {
  confirmEstablished(serverId, sender, peer);
  allowResumeAgain(convKey(serverId, sender));
}

function allowResumeAgain(key: string): void {
  resumeOffered.delete(key);
}

// A decryptable payload proves the peer completed the handshake, so a responder
// still showing "negotiating" can move to established.
function confirmEstablished(
  serverId: string,
  sender: string,
  peer: PeerRef,
): void {
  const key = convKey(serverId, sender);
  if (getStore()?.getState().e2eeSessions[key]?.status !== "negotiating")
    return;
  clearNegotiationTimer(key);
  forgetConversation(key);
  const fingerprint = backend.peerFingerprint(peer) ?? "";
  dispatch(serverId, sender, {
    type: "accepted-remote",
    peerFingerprint: fingerprint,
  });
  reconcilePeerTrust(obbyPeerTrust, serverId, sender, fingerprint);
  noteSessionEstablished(serverId, sender);
}

// Ciphertext this client cannot open, either because the session is gone or
// because the ratchet lost step. Show the row so the conversation doesn't
// appear to have gaps, then try to get encryption back: a peer we have already
// encrypted with gets a fresh offer, and anyone else is told our side is gone
// so their lock falls instead of them typing into something unreadable.
function handleUnreadable(
  serverId: string,
  nick: string,
  msgid?: string,
): void {
  injectUndecryptable(serverId, nick, nick, msgid);
  const key = convKey(serverId, nick);

  if (resumeOffered.has(key)) return;
  resumeOffered.add(key);
  // Offering again is the answer where consent already exists, and the lock
  // going amber reports it. Telling the user to act here would ask for the
  // thing this line just did.
  if (obbyPeerTrust.shouldAutoResume(serverId, nick)) {
    startE2EESession(serverId, nick);
    return;
  }

  // Nothing further will be attempted, so this is where the user is the remedy.
  send(serverId, nick, { t: "close", v: PROTOCOL_VERSION }, true);
  if (orphanCiphertextWarned.has(key)) return;
  orphanCiphertextWarned.add(key);
  injectSystemNotice(
    serverId,
    nick,
    t`${nick} is sending encrypted messages this device cannot read. Encryption has to be started again before they open.`,
  );
}

// Re-encrypt a conversation the user has already encrypted with once, when it
// opens with the lock off. Nothing here asks: the consent was given the first
// time and lives in the pin until the user ends encryption by hand.
export function resumeE2EEIfKnown(serverId: string, nick: string): void {
  const status =
    getStore()?.getState().e2eeSessions[convKey(serverId, nick)]?.status;
  if (status && status !== "none") return;
  if (!obbyPeerTrust.shouldAutoResume(serverId, nick)) return;
  startE2EESession(serverId, nick);
}

function safeFingerprint(payload: E2EEInit | E2EEAccept): string {
  try {
    return backend.offeredFingerprint(payload);
  } catch {
    return "";
  }
}

// An offer opens a PM thread, so it reaches the sidebar the same way a message
// does and has to respect the same ignore list. Every other inbound path checks
// this; a control frame that skipped it would hand any nick on the network an
// unread row the user cannot refuse.
export function isE2EESenderIgnored(sender: string): boolean {
  const ignoreList = getStore()?.getState().globalSettings.ignoreList;
  return isUserIgnored(sender, undefined, undefined, ignoreList);
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
    if (isE2EESenderIgnored(sender)) return;
    dispatchDecoded(serverId, sender, raw);
  });
}

// Returns true when the PRIVMSG body carries the Obby ciphertext marker, so the
// USERMSG handler consumes it instead of rendering the encoded body.
// `skipProcessing` swallows the frame without driving the session, for our own
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
  if (raw !== null)
    dispatchDecoded(serverId, sender, raw, {
      msgid,
      replyTo: replyTagOf(mtags),
    });
  return true;
}

// Per-conversation notices that must not carry across sessions: a peer whose
// next session also breaks has to be reported again. The resume latch resets on
// its own trigger (see allowResumeAgain), not on this one.
function forgetConversation(key: string): void {
  orphanCiphertextWarned.delete(key);
  versionRejected.delete(key);
}

export function startE2EESession(serverId: string, nick: string): void {
  const peer: PeerRef = { serverId, nick };
  forgetConversation(convKey(serverId, nick));
  obbyPeerTrust.setAutoResume(serverId, nick, true);
  // Any session already here is the one that just stopped working, and the
  // reducer holds `established` through a `start`. Left in place, the lock stays
  // green and every message goes on encrypting into keys the peer cannot open.
  // Dropping it first puts the conversation in a state that withholds instead.
  backend.reset(peer);
  dispatch(serverId, nick, { type: "reset" });
  send(serverId, nick, backend.startSession(peer), true);
  dispatch(serverId, nick, { type: "start", scheme: "obby" });
  armNegotiationTimer(serverId, nick, () => backend.reset(peer));
}

export function acceptE2EEOffer(serverId: string, nick: string): void {
  const key = convKey(serverId, nick);
  const offer = pendingOffers.get(key);
  if (!offer) return;
  pendingOffers.delete(key);
  obbyPeerTrust.setAutoResume(serverId, nick, true);
  const peer: PeerRef = { serverId, nick };
  let accept: E2EEAccept;
  try {
    accept = backend.acceptOffer(peer, offer);
  } catch {
    dispatch(serverId, nick, { type: "error", reason: "handshake-failed" });
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
  obbyPeerTrust.setAutoResume(serverId, nick, false);
  send(serverId, nick, { t: "reject", v: PROTOCOL_VERSION }, true);
  dispatch(serverId, nick, { type: "reject-local" });
}

function tearDown(serverId: string, nick: string, tellPeer: boolean): void {
  const key = convKey(serverId, nick);
  const peer: PeerRef = { serverId, nick };
  clearNegotiationTimer(key);
  allowResumeAgain(key);
  // Tell the peer before dropping our own keys, so their lock falls too rather
  // than leaving them encrypting into a session that no longer decrypts.
  if (tellPeer && (backend.hasSession(peer) || backend.hasPending(peer))) {
    send(serverId, nick, { t: "close", v: PROTOCOL_VERSION }, true);
  }
  backend.reset(peer);
  pendingOffers.delete(key);
  forgetConversation(key);
  dispatch(serverId, nick, { type: "reset" });
}

export function resetE2EESession(serverId: string, nick: string): void {
  tearDown(serverId, nick, true);
  // Ending it by hand has to stick, or the next thing the peer sends would pull
  // the lock straight back on.
  obbyPeerTrust.setAutoResume(serverId, nick, false);
}

// Drop the session because the transport went away, which says nothing about
// what the user wants. The pin keeps its auto-resume, so the conversation
// re-encrypts on reconnect; clearing it here would let one dropped socket
// disable encryption for every peer on the server. Nothing is sent: there is
// no connection left to send it on.
export function dropE2EESessionForDisconnect(
  serverId: string,
  nick: string,
): void {
  tearDown(serverId, nick, false);
}

export function trustE2EEChangedKey(serverId: string, nick: string): void {
  trustChangedKey(obbyPeerTrust, serverId, nick);
}

export function verifyE2EESession(serverId: string, nick: string): void {
  obbyPeerTrust.setVerified(serverId, nick);
  dispatch(serverId, nick, { type: "verify" });
}

// Send an already-uploaded, already-encrypted attachment. The descriptor holds
// the file key, so it only ever travels inside the session ciphertext.
export function sendEncryptedMedia(
  serverId: string,
  nick: string,
  descriptor: MediaDescriptor,
): boolean {
  const peer: PeerRef = { serverId, nick };
  if (!backend.hasSession(peer)) return false;
  const carrier = carrierRef(serverId);
  send(
    serverId,
    nick,
    backend.encryptMediaFrame(peer, encodeMediaDescriptor(descriptor)),
    false,
    carrier,
  );
  const self = getStore()?.getState().currentUser?.username ?? "";
  injectMediaMessage(serverId, nick, self, descriptor, carrier);
  return true;
}

// Encrypt and send an outgoing PM, echoing the plaintext locally since the
// ciphertext rides on an invisible TAGMSG the sender won't otherwise see.
export function sendEncryptedMessage(
  serverId: string,
  nick: string,
  content: string,
  replyTo?: string,
): void {
  const peer: PeerRef = { serverId, nick };
  if (!backend.hasSession(peer)) return;
  const carrier = carrierRef(serverId, replyTo);
  send(serverId, nick, backend.encrypt(peer, content), false, carrier);
  const store = getStore();
  if (!store) return;
  const self = store.getState().currentUser?.username ?? "";
  injectMessage(serverId, nick, self, content, carrier);
}
