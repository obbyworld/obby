// Trust-on-first-use (TOFU) store for peer fingerprints, shared by both E2EE
// schemes. The first fingerprint seen for a peer is pinned; a later mismatch is
// reported as "changed" so the UI can warn about a possible MITM. Each scheme
// passes its own storage key — the fingerprint formats and key material differ,
// so the pins must not be mixed.

import { e2eeSessionKey } from "./session";

export interface PinnedPeer {
  fingerprint: string;
  verified: boolean;
}

export type PinResult = "new" | "same" | "changed";

export interface PeerTrustStore {
  get(serverId: string, nick: string): PinnedPeer | null;
  // Pin on first sight; report whether it is new, unchanged, or changed. A
  // "changed" result does NOT overwrite the pin — the caller decides.
  pin(serverId: string, nick: string, fingerprint: string): PinResult;
  setVerified(serverId: string, nick: string): void;
  // Replace the pinned key and clear the verified flag (e.g. after the user
  // accepts a changed key).
  repin(serverId: string, nick: string, fingerprint: string): void;
}

export function createPeerTrustStore(storageKey: string): PeerTrustStore {
  const peerKey = e2eeSessionKey;

  function load(): Record<string, PinnedPeer> {
    let raw: string | null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function save(peers: Record<string, PinnedPeer>): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(peers));
    } catch {}
  }

  return {
    get(serverId, nick) {
      return load()[peerKey(serverId, nick)] ?? null;
    },
    pin(serverId, nick, fingerprint) {
      const peers = load();
      const key = peerKey(serverId, nick);
      const existing = peers[key];
      if (!existing) {
        peers[key] = { fingerprint, verified: false };
        save(peers);
        return "new";
      }
      return existing.fingerprint === fingerprint ? "same" : "changed";
    },
    setVerified(serverId, nick) {
      const peers = load();
      const key = peerKey(serverId, nick);
      if (peers[key]) {
        peers[key].verified = true;
        save(peers);
      }
    },
    repin(serverId, nick, fingerprint) {
      const peers = load();
      peers[peerKey(serverId, nick)] = { fingerprint, verified: false };
      save(peers);
    },
  };
}
