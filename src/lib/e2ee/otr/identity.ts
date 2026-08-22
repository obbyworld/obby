// OTR long-term identity. OTRv3 mandates a per-install DSA key; we generate it
// once (off the main thread, since keygen is ~2s), persist it, and derive the 40-hex
// SHA-1 fingerprint that other OTR clients (Pidgin, irssi) display so users can
// verify across clients. Peer fingerprint pinning (TOFU) lives in the shared
// peer-trust store.

import { loadOtr } from "../../otr/vendor/loader";
import type { DSAKey } from "../../otr/vendor/otr.bundle";
import { createPeerTrustStore } from "../peerTrust";

const IDENTITY_KEY = "obsidian.otr.identity";

export const otrPeerTrust = createPeerTrustStore("obsidian.otr.peers");

let cached: DSAKey | null = null;
let pending: Promise<DSAKey> | null = null;

async function loadStoredKey(): Promise<DSAKey | null> {
  let packed: string | null;
  try {
    packed = localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
  if (!packed) return null;
  const { DSA } = await loadOtr();
  try {
    return DSA.parsePrivate(packed);
  } catch {
    return null;
  }
}

// DSA keygen blocks for ~2s in pure JS, so run it in a worker; the persisted key
// makes this a one-time cost. Falls back to synchronous keygen only where Worker
// is unavailable (tests/SSR), since production always has it.
async function generateKey(): Promise<DSAKey> {
  const { DSA } = await loadOtr();
  if (typeof Worker === "undefined") {
    return new DSA();
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./keygen.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<string>) => {
      worker.terminate();
      resolve(DSA.parsePrivate(e.data));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage("generate");
  });
}

// The OTR identity, generated and persisted on first use. Concurrent callers
// share one in-flight keygen rather than racing two keys into existence.
export function getIdentity(): Promise<DSAKey> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = resolveIdentity()
    .then((key) => {
      cached = key;
      pending = null;
      return key;
    })
    // Clear the in-flight handle on failure so a later call retries keygen
    // instead of returning the same rejected promise forever.
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

async function resolveIdentity(): Promise<DSAKey> {
  const stored = await loadStoredKey();
  if (stored) return stored;
  const key = await generateKey();
  try {
    localStorage.setItem(IDENTITY_KEY, key.packPrivate());
  } catch {}
  return key;
}

// 40 hex chars grouped into five blocks of eight, matching how libotr clients
// (Pidgin, irssi) render OTR fingerprints so a user can read one out and
// compare. Distinct from e2ee/fingerprint.ts, which formats raw key bytes.
export function formatOtrFingerprint(hex: string): string {
  return hex.match(/.{1,8}/g)?.join(" ") ?? hex;
}
