// X3DH key agreement + the Signal Double Ratchet, built on audited @noble
// primitives (X25519, Ed25519, HKDF-SHA256, HMAC-SHA256, XChaCha20-Poly1305).
// This is the cryptographic core of Obby-native PM E2EE: it establishes a
// shared session from a pre-key bundle and then provides forward-secret,
// post-compromise-secure, out-of-order-tolerant message encryption. It is pure
// (no IRC/store/wire dependency) so it can be tested directly against the spec.
//
// Spec references: Signal "The X3DH Key Agreement Protocol" and "The Double
// Ratchet Algorithm". The construction here follows them; only the primitive
// choices (XChaCha20-Poly1305 AEAD, HKDF/HMAC-SHA256) and serialization are
// ours.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64ToBytes, bytesToBase64 } from "../base64";
import { formatFingerprint } from "./fingerprint";

// Drop a conversation rather than buffer unboundedly when a peer's message
// numbers jump implausibly far ahead (lost/forged fragments).
const MAX_SKIP = 1000;

// Total retained out-of-order message keys per session. Each DH ratchet step
// resets the per-chain counter, so without a ceiling a peer could grow this
// map forever; retained keys are also live decryption material, so the bound
// caps how far back a compromise of the running client reaches.
const MAX_SKIPPED_KEYS = 2000;

const ROOT_INFO = utf8ToBytes("obby.world/e2ee root");
const MESSAGE_INFO = utf8ToBytes("obby.world/e2ee message");
const NONCE_INFO = utf8ToBytes("obby.world/e2ee nonce");
const ZERO_SALT = new Uint8Array(32);
const NONCE_BYTES = 24;

// Plaintext is padded up to a multiple of this before encryption so ciphertext
// length reveals only a bucket, not the exact message size.
const PAD_BLOCK = 64;

function dh(secret: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secret, theirPublic);
}

// Root-key KDF: advances the root key and yields a fresh chain key from a DH
// output. salt = current root key, ikm = DH output.
function kdfRoot(
  rootKey: Uint8Array,
  dhOut: Uint8Array,
): [Uint8Array, Uint8Array] {
  const out = hkdf(sha256, dhOut, rootKey, ROOT_INFO, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

// Chain-key KDF: HMAC with distinct constants gives the next chain key and this
// message's key (Signal §symmetric-key ratchet).
function kdfChain(chainKey: Uint8Array): [Uint8Array, Uint8Array] {
  const messageKey = hmac(sha256, chainKey, Uint8Array.of(0x01));
  const nextChainKey = hmac(sha256, chainKey, Uint8Array.of(0x02));
  return [nextChainKey, messageKey];
}

function aeadKey(messageKey: Uint8Array): Uint8Array {
  return hkdf(sha256, messageKey, ZERO_SALT, MESSAGE_INFO, 32);
}

// Each message key is used for exactly one message, so the nonce can be derived
// from it rather than carried on the wire.
function aeadNonce(messageKey: Uint8Array): Uint8Array {
  return hkdf(sha256, messageKey, ZERO_SALT, NONCE_INFO, NONCE_BYTES);
}

// ISO/IEC 7816-4 padding: a 0x80 marker followed by zeros to the block
// boundary, so the original length is recoverable without a length prefix.
function pad(plaintext: Uint8Array): Uint8Array {
  const padded = new Uint8Array(
    (Math.floor(plaintext.length / PAD_BLOCK) + 1) * PAD_BLOCK,
  );
  padded.set(plaintext);
  padded[plaintext.length] = 0x80;
  return padded;
}

function unpad(padded: Uint8Array): Uint8Array {
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0x00) i--;
  if (i < 0 || padded[i] !== 0x80) throw new Error("e2ee: bad padding");
  return padded.slice(0, i);
}

// The header fields are authenticated as AEAD associated data so a peer can't
// rewrite the ratchet public key or counters without breaking decryption.
function headerAad(dhPub: string, pn: number, n: number): Uint8Array {
  return utf8ToBytes(`${dhPub}.${pn}.${n}`);
}

export interface Identity {
  ikPriv: Uint8Array;
  ikPub: Uint8Array;
  sikPriv: Uint8Array;
  sikPub: Uint8Array;
}

export function createIdentity(): Identity {
  const ikPriv = x25519.utils.randomSecretKey();
  const sikPriv = ed25519.utils.randomSecretKey();
  return {
    ikPriv,
    ikPub: x25519.getPublicKey(ikPriv),
    sikPriv,
    sikPub: ed25519.getPublicKey(sikPriv),
  };
}

// Stable, comparable fingerprint of a signing key for out-of-band verification.
export function fingerprintOf(signingPublicKey: Uint8Array): string {
  return formatFingerprint(sha256(signingPublicKey));
}

export interface PreKeyBundle {
  ik: string;
  sik: string;
  spk: string;
  // Ed25519(ik‖spk‖opk) by sik. Covering every offered key stops an off-path
  // attacker from keeping the genuine signed pair and splicing in its own
  // identity or one-time key.
  sig: string;
  opk: string;
}

export interface RatchetMessage {
  dh: string;
  pn: number;
  n: number;
  ct: string;
}

export interface HandshakeResponse {
  ik: string;
  sik: string;
  ek: string;
  // Ed25519(ik‖ek) by sik: binds the fingerprinted key to the session's DH keys.
  sig: string;
  boot: RatchetMessage;
}

// Pre-keys the initiator must keep to complete the handshake once the responder
// replies; never sent on the wire.
export interface PendingHandshake {
  bundle: PreKeyBundle;
  spkPriv: Uint8Array;
  opkPriv: Uint8Array;
}

interface RatchetState {
  dhsPriv: Uint8Array;
  dhsPub: Uint8Array;
  dhrPub?: Uint8Array;
  rk: Uint8Array;
  cks?: Uint8Array;
  ckr?: Uint8Array;
  ns: number;
  nr: number;
  pn: number;
  skipped: Map<string, Uint8Array>;
}

export type { RatchetState };

function bundleSigningPayload(
  ik: Uint8Array,
  spk: Uint8Array,
  opk: Uint8Array,
): Uint8Array {
  return concatBytes(ik, spk, opk);
}

// Initiator: publish a signed pre-key bundle and retain the matching private
// keys to finish the handshake when the responder's reply arrives.
export function createPreKeyBundle(id: Identity): PendingHandshake {
  const spkPriv = x25519.utils.randomSecretKey();
  const spkPub = x25519.getPublicKey(spkPriv);
  const opkPriv = x25519.utils.randomSecretKey();
  const opkPub = x25519.getPublicKey(opkPriv);
  const bundle: PreKeyBundle = {
    ik: bytesToBase64(id.ikPub),
    sik: bytesToBase64(id.sikPub),
    spk: bytesToBase64(spkPub),
    sig: bytesToBase64(
      ed25519.sign(bundleSigningPayload(id.ikPub, spkPub, opkPub), id.sikPriv),
    ),
    opk: bytesToBase64(opkPub),
  };
  return { bundle, spkPriv, opkPriv };
}

function x3dhSecret(
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array,
  dh4: Uint8Array,
): Uint8Array {
  const ikm = concatBytes(dh1, dh2, dh3, dh4);
  return hkdf(sha256, ikm, ZERO_SALT, utf8ToBytes("obby.world/e2ee x3dh"), 32);
}

// Responder: verify and consume the initiator's bundle, derive the shared
// secret, open the sending ratchet, and produce the reply plus a first
// (bootstrap) ciphertext that establishes the initiator's receiving side.
export function acceptBundle(
  id: Identity,
  bundle: PreKeyBundle,
  firstPlaintext: string,
): { response: HandshakeResponse; state: RatchetState } {
  const spk = base64ToBytes(bundle.spk);
  const sik = base64ToBytes(bundle.sik);
  const theirIk = base64ToBytes(bundle.ik);
  const theirOpk = base64ToBytes(bundle.opk);
  if (
    !ed25519.verify(
      base64ToBytes(bundle.sig),
      bundleSigningPayload(theirIk, spk, theirOpk),
      sik,
    )
  ) {
    throw new Error("e2ee: pre-key bundle signature invalid");
  }
  const ekPriv = x25519.utils.randomSecretKey();
  const sk = x3dhSecret(
    dh(id.ikPriv, spk),
    dh(ekPriv, theirIk),
    dh(ekPriv, spk),
    dh(ekPriv, theirOpk),
  );
  const state = initSender(sk, spk);
  const boot = ratchetEncrypt(state, firstPlaintext);
  const ekPub = x25519.getPublicKey(ekPriv);
  return {
    response: {
      ik: bytesToBase64(id.ikPub),
      sik: bytesToBase64(id.sikPub),
      ek: bytesToBase64(ekPub),
      sig: bytesToBase64(
        ed25519.sign(concatBytes(id.ikPub, ekPub), id.sikPriv),
      ),
      boot,
    },
    state,
  };
}

// Initiator: complete the handshake from the responder's reply, derive the same
// shared secret, open the receiving ratchet, and decrypt the bootstrap message.
export function completeHandshake(
  id: Identity,
  pending: PendingHandshake,
  response: HandshakeResponse,
): { state: RatchetState; firstPlaintext: string } {
  const theirIk = base64ToBytes(response.ik);
  const theirEk = base64ToBytes(response.ek);
  if (
    !ed25519.verify(
      base64ToBytes(response.sig),
      concatBytes(theirIk, theirEk),
      base64ToBytes(response.sik),
    )
  ) {
    throw new Error("e2ee: responder identity signature invalid");
  }
  const sk = x3dhSecret(
    dh(pending.spkPriv, theirIk),
    dh(id.ikPriv, theirEk),
    dh(pending.spkPriv, theirEk),
    dh(pending.opkPriv, theirEk),
  );
  const state = initReceiver(sk, {
    dhsPriv: pending.spkPriv,
    dhsPub: base64ToBytes(pending.bundle.spk),
  });
  const firstPlaintext = ratchetDecrypt(state, response.boot);
  return { state, firstPlaintext };
}

function initSender(sk: Uint8Array, theirRatchetPub: Uint8Array): RatchetState {
  const dhsPriv = x25519.utils.randomSecretKey();
  const dhsPub = x25519.getPublicKey(dhsPriv);
  const [rk, cks] = kdfRoot(sk, dh(dhsPriv, theirRatchetPub));
  return {
    dhsPriv,
    dhsPub,
    dhrPub: theirRatchetPub,
    rk,
    cks,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

function initReceiver(
  sk: Uint8Array,
  ratchetKey: { dhsPriv: Uint8Array; dhsPub: Uint8Array },
): RatchetState {
  return {
    dhsPriv: ratchetKey.dhsPriv,
    dhsPub: ratchetKey.dhsPub,
    rk: sk,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
): RatchetMessage {
  if (!state.cks) throw new Error("e2ee: no sending chain");
  const [nextCk, mk] = kdfChain(state.cks);
  state.cks = nextCk;
  const dhPub = bytesToBase64(state.dhsPub);
  const pn = state.pn;
  const n = state.ns;
  state.ns += 1;
  const ct = xchacha20poly1305(
    aeadKey(mk),
    aeadNonce(mk),
    headerAad(dhPub, pn, n),
  ).encrypt(pad(utf8ToBytes(plaintext)));
  return { dh: dhPub, pn, n, ct: bytesToBase64(ct) };
}

export function ratchetDecrypt(
  state: RatchetState,
  msg: RatchetMessage,
): string {
  // Trial-decrypt against a copy and only commit the advanced ratchet state
  // once the AEAD tag verifies. Otherwise a forged packet with a valid header
  // but garbage ciphertext would burn a skipped-message key or desync the
  // receiving chain, letting a malicious relay silently censor real messages.
  const working = cloneState(state);
  const plaintext = decryptStep(working, msg);
  commitState(state, working);
  return plaintext;
}

function decryptStep(state: RatchetState, msg: RatchetMessage): string {
  const skippedKey = `${msg.dh}:${msg.n}`;
  const skippedMk = state.skipped.get(skippedKey);
  if (skippedMk) {
    const plaintext = aeadDecrypt(skippedMk, msg);
    state.skipped.delete(skippedKey);
    return plaintext;
  }
  if (!state.dhrPub || bytesToBase64(state.dhrPub) !== msg.dh) {
    skipReceivingKeys(state, msg.pn);
    dhRatchet(state, base64ToBytes(msg.dh));
  }
  skipReceivingKeys(state, msg.n);
  if (!state.ckr) throw new Error("e2ee: no receiving chain");
  const [nextCk, mk] = kdfChain(state.ckr);
  const plaintext = aeadDecrypt(mk, msg);
  state.ckr = nextCk;
  state.nr += 1;
  return plaintext;
}

function cloneState(s: RatchetState): RatchetState {
  return {
    dhsPriv: s.dhsPriv.slice(),
    dhsPub: s.dhsPub.slice(),
    dhrPub: s.dhrPub?.slice(),
    rk: s.rk.slice(),
    cks: s.cks?.slice(),
    ckr: s.ckr?.slice(),
    ns: s.ns,
    nr: s.nr,
    pn: s.pn,
    skipped: new Map(s.skipped),
  };
}

function commitState(target: RatchetState, src: RatchetState): void {
  target.dhsPriv = src.dhsPriv;
  target.dhsPub = src.dhsPub;
  target.dhrPub = src.dhrPub;
  target.rk = src.rk;
  target.cks = src.cks;
  target.ckr = src.ckr;
  target.ns = src.ns;
  target.nr = src.nr;
  target.pn = src.pn;
  target.skipped = src.skipped;
}

// Advance the receiving chain to `until`, stashing each skipped message key so a
// later out-of-order message can still be decrypted.
function skipReceivingKeys(state: RatchetState, until: number): void {
  if (!state.ckr) return;
  if (state.nr + MAX_SKIP < until) {
    throw new Error("e2ee: too many skipped messages");
  }
  const dhPub = state.dhrPub ? bytesToBase64(state.dhrPub) : "";
  while (state.nr < until) {
    const [nextCk, mk] = kdfChain(state.ckr);
    state.ckr = nextCk;
    // Map iteration is insertion-ordered, so the first entry is the oldest.
    while (state.skipped.size >= MAX_SKIPPED_KEYS) {
      const oldest = state.skipped.keys().next().value;
      if (oldest === undefined) break;
      state.skipped.delete(oldest);
    }
    state.skipped.set(`${dhPub}:${state.nr}`, mk);
    state.nr += 1;
  }
}

function dhRatchet(state: RatchetState, theirNewDh: Uint8Array): void {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhrPub = theirNewDh;
  [state.rk, state.ckr] = kdfRoot(state.rk, dh(state.dhsPriv, theirNewDh));
  state.dhsPriv = x25519.utils.randomSecretKey();
  state.dhsPub = x25519.getPublicKey(state.dhsPriv);
  [state.rk, state.cks] = kdfRoot(state.rk, dh(state.dhsPriv, theirNewDh));
}

function aeadDecrypt(messageKey: Uint8Array, msg: RatchetMessage): string {
  const padded = xchacha20poly1305(
    aeadKey(messageKey),
    aeadNonce(messageKey),
    headerAad(msg.dh, msg.pn, msg.n),
  ).decrypt(base64ToBytes(msg.ct));
  return new TextDecoder().decode(unpad(padded));
}
