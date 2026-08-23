// The Obby-native E2EE backend: holds the local long-term identity and the
// per-conversation ratchet/handshake state, and translates between the
// cryptographic core (ratchet.ts) and the opaque wire payloads (protocol.ts).
// The store drives it; it owns no IRC, React, or persistence concerns so it
// stays unit-testable on its own.

import { base64DecodeUtf8, base64EncodeUtf8, base64ToBytes } from "../base64";
import {
  type E2EEAccept,
  type E2EEAck,
  type E2EECipher,
  type E2EEInit,
  type E2EEMediaFrame,
  PROTOCOL_VERSION,
} from "./protocol";
import {
  acceptBundle,
  completeHandshake,
  createIdentity,
  createPreKeyBundle,
  fingerprintOf,
  type HandshakeResponse,
  type Identity,
  type PendingHandshake,
  type PreKeyBundle,
  type RatchetMessage,
  type RatchetState,
  ratchetDecrypt,
  ratchetEncrypt,
} from "./ratchet";
import { e2eeSessionKey } from "./session";

export interface PeerRef {
  serverId: string;
  nick: string;
}

function peerKey(peer: PeerRef): string {
  return e2eeSessionKey(peer.serverId, peer.nick);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function encode(value: unknown): string {
  return base64EncodeUtf8(JSON.stringify(value));
}

function parse(blob: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(base64DecodeUtf8(blob));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("e2ee: malformed payload");
  }
  return parsed as Record<string, unknown>;
}

function decodeBundle(blob: string): PreKeyBundle {
  const o = parse(blob);
  if (
    !isString(o.ik) ||
    !isString(o.sik) ||
    !isString(o.spk) ||
    !isString(o.sig) ||
    !isString(o.opk)
  ) {
    throw new Error("e2ee: malformed bundle");
  }
  return { ik: o.ik, sik: o.sik, spk: o.spk, sig: o.sig, opk: o.opk };
}

function decodeRatchetMessage(o: Record<string, unknown>): RatchetMessage {
  if (
    !isString(o.dh) ||
    !isString(o.ct) ||
    typeof o.pn !== "number" ||
    typeof o.n !== "number"
  ) {
    throw new Error("e2ee: malformed ratchet message");
  }
  return { dh: o.dh, pn: o.pn, n: o.n, ct: o.ct };
}

function decodeResponse(blob: string): HandshakeResponse {
  const o = parse(blob);
  if (
    !isString(o.ik) ||
    !isString(o.sik) ||
    !isString(o.ek) ||
    !isString(o.sig) ||
    !o.boot ||
    typeof o.boot !== "object"
  ) {
    throw new Error("e2ee: malformed handshake response");
  }
  return {
    ik: o.ik,
    sik: o.sik,
    ek: o.ek,
    sig: o.sig,
    boot: decodeRatchetMessage(o.boot as Record<string, unknown>),
  };
}

export class ObbyE2EEBackend {
  private readonly identity: Identity;
  private readonly sessions = new Map<string, RatchetState>();
  private readonly pending = new Map<string, PendingHandshake>();
  private readonly peerFingerprints = new Map<string, string>();

  constructor(identity: Identity = createIdentity()) {
    this.identity = identity;
  }

  selfFingerprint(): string {
    return fingerprintOf(this.identity.sikPub);
  }

  // The fingerprint claimed by an inbound offer/response, derived from its
  // signing key, for the accept prompt and trust-on-first-use pinning before a
  // session exists.
  offeredFingerprint(payload: E2EEInit | E2EEAccept): string {
    const sik =
      payload.t === "init"
        ? decodeBundle(payload.bundle).sik
        : decodeResponse(payload.response).sik;
    return fingerprintOf(base64ToBytes(sik));
  }

  startSession(peer: PeerRef): E2EEInit {
    const handshake = createPreKeyBundle(this.identity);
    this.pending.set(peerKey(peer), handshake);
    return {
      t: "init",
      v: PROTOCOL_VERSION,
      bundle: encode(handshake.bundle),
    };
  }

  acceptOffer(peer: PeerRef, init: E2EEInit): E2EEAccept {
    const bundle = decodeBundle(init.bundle);
    const { response, state } = acceptBundle(this.identity, bundle, "");
    const key = peerKey(peer);
    this.sessions.set(key, state);
    this.peerFingerprints.set(key, fingerprintOf(base64ToBytes(bundle.sik)));
    return { t: "accept", v: PROTOCOL_VERSION, response: encode(response) };
  }

  completeSession(peer: PeerRef, accept: E2EEAccept): void {
    const key = peerKey(peer);
    const handshake = this.pending.get(key);
    if (!handshake) throw new Error("e2ee: no pending handshake for peer");
    const response = decodeResponse(accept.response);
    const { state } = completeHandshake(this.identity, handshake, response);
    this.sessions.set(key, state);
    this.pending.delete(key);
    this.peerFingerprints.set(key, fingerprintOf(base64ToBytes(response.sik)));
  }

  encrypt(peer: PeerRef, plaintext: string): E2EECipher {
    const state = this.sessions.get(peerKey(peer));
    if (!state) throw new Error("e2ee: no session for peer");
    return {
      t: "msg",
      v: PROTOCOL_VERSION,
      ct: encode(ratchetEncrypt(state, plaintext)),
    };
  }

  // An attachment descriptor, encrypted like a message but carried as its own
  // frame so the receiver renders media instead of text.
  encryptMediaFrame(peer: PeerRef, descriptor: string): E2EEMediaFrame {
    const state = this.sessions.get(peerKey(peer));
    if (!state) throw new Error("e2ee: no session for peer");
    return {
      t: "media",
      v: PROTOCOL_VERSION,
      ct: encode(ratchetEncrypt(state, descriptor)),
    };
  }

  // The handshake proof: a ciphertext the peer can only produce with a live
  // session, carrying no message content.
  encryptAck(peer: PeerRef): E2EEAck {
    const state = this.sessions.get(peerKey(peer));
    if (!state) throw new Error("e2ee: no session for peer");
    return {
      t: "ack",
      v: PROTOCOL_VERSION,
      ct: encode(ratchetEncrypt(state, "")),
    };
  }

  decrypt(
    peer: PeerRef,
    cipher: E2EECipher | E2EEAck | E2EEMediaFrame,
  ): string {
    const state = this.sessions.get(peerKey(peer));
    if (!state) throw new Error("e2ee: no session for peer");
    return ratchetDecrypt(state, decodeRatchetMessage(parse(cipher.ct)));
  }

  peerFingerprint(peer: PeerRef): string | null {
    return this.peerFingerprints.get(peerKey(peer)) ?? null;
  }

  hasSession(peer: PeerRef): boolean {
    return this.sessions.has(peerKey(peer));
  }

  hasPending(peer: PeerRef): boolean {
    return this.pending.has(peerKey(peer));
  }

  reset(peer: PeerRef): void {
    const key = peerKey(peer);
    this.sessions.delete(key);
    this.pending.delete(key);
    this.peerFingerprints.delete(key);
  }
}
