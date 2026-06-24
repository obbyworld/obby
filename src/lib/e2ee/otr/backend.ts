// Thin wrapper over the vendored otr.js engine: one OTR instance per peer, all
// sharing our long-term DSA identity. The library is event-driven (AKE rounds
// and fragments are emitted asynchronously via "io"), so this surfaces those as
// callbacks rather than return values. The orchestration layer wires the
// callbacks to the IRC transport and the session reducer.

import type {
  DSAKey,
  OtrInstance,
  OtrStatic,
} from "../../otr/vendor/otr.bundle";

export interface OtrPeerRef {
  serverId: string;
  nick: string;
}

export interface OtrCallbacks {
  // An OTR frame to put on the wire as a PRIVMSG to the peer (already fragmented
  // to the IRC line budget by the engine).
  onOutbound: (peer: OtrPeerRef, frame: string) => void;
  onPlaintext: (peer: OtrPeerRef, message: string) => void;
  onEstablished: (peer: OtrPeerRef, fingerprint: string) => void;
  onEnded: (peer: OtrPeerRef) => void;
  onError: (peer: OtrPeerRef, error: string) => void;
}

export interface OtrBackendOptions {
  fragmentSize?: number;
  sendInterval?: number;
}

// IRC PRIVMSG lines cap at 512 bytes including the `:nick!user@host PRIVMSG
// target :` envelope and CRLF; ~400 leaves headroom for the worst-case envelope.
const IRC_FRAGMENT_SIZE = 400;
// A small inter-fragment delay so a multi-fragment message doesn't trip IRC
// flood throttling.
const IRC_SEND_INTERVAL = 200;

function sessionKey(peer: OtrPeerRef): string {
  return `${peer.serverId}:${peer.nick.toLowerCase()}`;
}

export class OtrBackend {
  private sessions = new Map<string, OtrInstance>();

  // The OTR engine class is injected (rather than imported) so the vendored
  // bundle stays lazily loaded — see vendor/loader.ts.
  constructor(
    private otr: OtrStatic,
    private identity: DSAKey,
    private callbacks: OtrCallbacks,
    private options: OtrBackendOptions = {},
  ) {}

  /** Our long-term fingerprint (raw 40-hex); the UI groups it for display. */
  selfFingerprint(): string {
    return this.identity.fingerprint();
  }

  hasSession(peer: OtrPeerRef): boolean {
    return this.sessions.has(sessionKey(peer));
  }

  /** The peer's long-term fingerprint (raw 40-hex), available after the AKE. */
  peerFingerprint(peer: OtrPeerRef): string | null {
    return (
      this.sessions.get(sessionKey(peer))?.their_priv_pk?.fingerprint() ?? null
    );
  }

  private session(peer: OtrPeerRef): OtrInstance {
    const key = sessionKey(peer);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const instance = new this.otr({
      priv: this.identity,
      fragment_size: this.options.fragmentSize ?? IRC_FRAGMENT_SIZE,
      send_interval: this.options.sendInterval ?? IRC_SEND_INTERVAL,
    });
    instance.on("io", (msg) => this.callbacks.onOutbound(peer, msg));
    instance.on("ui", (msg) => this.callbacks.onPlaintext(peer, msg));
    instance.on("status", (state) => {
      if (state === this.otr.CONST.STATUS_AKE_SUCCESS) {
        this.callbacks.onEstablished(
          peer,
          instance.their_priv_pk?.fingerprint() ?? "",
        );
      } else if (state === this.otr.CONST.STATUS_END_OTR) {
        this.callbacks.onEnded(peer);
      }
    });
    instance.on("error", (err) => this.callbacks.onError(peer, String(err)));
    this.sessions.set(key, instance);
    return instance;
  }

  // Start (or restart) a session by emitting the ?OTRv23? query; the peer's OTR
  // client answers and the AKE then runs through receive().
  start(peer: OtrPeerRef): void {
    this.session(peer).sendQueryMsg();
  }

  // Feed an inbound OTR frame; the resulting AKE responses, decrypted plaintext,
  // and status changes arrive through the callbacks. Creating the session on
  // demand lets an unsolicited inbound query auto-respond, as OTR clients do.
  receive(peer: OtrPeerRef, frame: string): void {
    this.session(peer).receiveMsg(frame);
  }

  // True only when the peer's session is actively encrypted. The UI lock and the
  // send path must gate on this — a session can leave ENCRYPTED (peer ended OTR,
  // desync) while the reducer still shows "established".
  isEncrypting(peer: OtrPeerRef): boolean {
    return (
      this.sessions.get(sessionKey(peer))?.msgstate ===
      this.otr.CONST.MSGSTATE_ENCRYPTED
    );
  }

  // Encrypt and send a user message; ciphertext frames arrive via onOutbound.
  // Returns false (sending nothing) when the session is not in the encrypted
  // state — arlolra's sendMsg silently falls back to PLAINTEXT otherwise, which
  // would leak under a lock the UI still shows as secure. The caller must treat
  // false as "not delivered".
  encrypt(peer: OtrPeerRef, content: string): boolean {
    const instance = this.sessions.get(sessionKey(peer));
    if (!instance || instance.msgstate !== this.otr.CONST.MSGSTATE_ENCRYPTED)
      return false;
    instance.sendMsg(content);
    return true;
  }

  end(peer: OtrPeerRef): void {
    const key = sessionKey(peer);
    const instance = this.sessions.get(key);
    if (instance) {
      instance.endOtr();
      this.sessions.delete(key);
    }
  }
}
