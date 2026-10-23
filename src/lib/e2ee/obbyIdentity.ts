// Obby-native long-term identity: the X25519 + Ed25519 keypair, persisted so the
// fingerprint is stable across reloads. Without persistence the identity would
// regenerate on every page load, making fingerprint verification and key-change
// detection meaningless. @noble keygen is microseconds, so unlike the OTR DSA key
// this needs no worker. Stored as base64 in localStorage.

import { base64ToBytes, bytesToBase64 } from "../base64";
import { createPeerTrustStore } from "./peerTrust";
import { createIdentity, type Identity } from "./ratchet";

const IDENTITY_KEY = "obsidian.obby.identity";

export const obbyPeerTrust = createPeerTrustStore("obsidian.obby.peers");

let cached: Identity | null = null;

interface SerializedIdentity {
  ikPriv: string;
  ikPub: string;
  sikPriv: string;
  sikPub: string;
}

function serialize(id: Identity): string {
  const s: SerializedIdentity = {
    ikPriv: bytesToBase64(id.ikPriv),
    ikPub: bytesToBase64(id.ikPub),
    sikPriv: bytesToBase64(id.sikPriv),
    sikPub: bytesToBase64(id.sikPub),
  };
  return JSON.stringify(s);
}

function deserialize(raw: string): Identity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.ikPriv !== "string" ||
    typeof o.ikPub !== "string" ||
    typeof o.sikPriv !== "string" ||
    typeof o.sikPub !== "string"
  )
    return null;
  try {
    return {
      ikPriv: base64ToBytes(o.ikPriv),
      ikPub: base64ToBytes(o.ikPub),
      sikPriv: base64ToBytes(o.sikPriv),
      sikPub: base64ToBytes(o.sikPub),
    };
  } catch {
    return null;
  }
}

export function getObbyIdentity(): Identity {
  if (cached) return cached;
  let stored: string | null;
  try {
    stored = localStorage.getItem(IDENTITY_KEY);
  } catch {
    stored = null;
  }
  if (stored) {
    const restored = deserialize(stored);
    if (restored) {
      cached = restored;
      return restored;
    }
  }
  const fresh = createIdentity();
  try {
    localStorage.setItem(IDENTITY_KEY, serialize(fresh));
  } catch {}
  cached = fresh;
  return fresh;
}
