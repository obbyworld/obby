// OTR (Off-the-Record) interop orchestration: OTRv3 sessions that interoperate
// with libotr-based clients (Pidgin, irssi, WeeChat). Unlike the Obby-native
// scheme, OTR rides in the PRIVMSG body, so inbound frames are diverted from the
// normal message path (handleInboundOtr, called by the USERMSG handler) and
// outbound frames are sent as plain PRIVMSGs. Both schemes share the session
// reducer and the lock/banner UI through e2eeConversation. The DSA identity key is
// generated lazily off the main thread, so the crypto calls are async.

import { classifyInbound } from "../../lib/e2ee/classify";
import { OtrBackend, type OtrPeerRef } from "../../lib/e2ee/otr/backend";
import { getIdentity, otrPeerTrust } from "../../lib/e2ee/otr/identity";
import ircClient from "../../lib/ircClient";
import { loadOtr } from "../../lib/otr/vendor/loader";
import { isE2EESenderIgnored } from "./e2ee";
import {
  armNegotiationTimer,
  clearNegotiationTimer,
  convKey,
  dispatch,
  ensurePrivateChat,
  getStore,
  injectMessage,
  noteSessionEstablished,
  OTR_NEGOTIATION_TIMEOUT_MS,
  reconcilePeerTrust,
  trustChangedKey,
} from "./e2eeConversation";

let backend: OtrBackend | null = null;
let backendPromise: Promise<OtrBackend> | null = null;
// Conversations we tore down ourselves, so the engine's end callback can tell
// our own teardown from the peer's.
const locallyEnded = new Set<string>();

function buildBackend(): Promise<OtrBackend> {
  if (backendPromise) return backendPromise;
  backendPromise = Promise.all([getIdentity(), loadOtr()])
    .then(([identity, { OTR }]) => {
      const built = new OtrBackend(OTR, identity, {
        onOutbound: (peer, frame) => {
          ircClient.sendRaw(peer.serverId, `PRIVMSG ${peer.nick} :${frame}`);
        },
        onPlaintext: (peer, message) => {
          injectMessage(peer.serverId, peer.nick, peer.nick, message);
        },
        onEstablished: (peer, fingerprint) => {
          clearNegotiationTimer(convKey(peer.serverId, peer.nick));
          dispatch(peer.serverId, peer.nick, {
            type: "accepted-remote",
            peerFingerprint: fingerprint,
          });
          reconcilePeerTrust(
            otrPeerTrust,
            peer.serverId,
            peer.nick,
            fingerprint,
          );
          noteSessionEstablished(peer.serverId, peer.nick);
        },
        onEnded: (peer) => {
          const key = convKey(peer.serverId, peer.nick);
          clearNegotiationTimer(key);
          // A peer-initiated teardown must not silently clear the lock: the
          // user is mid-conversation and would send the next line in the clear.
          if (locallyEnded.delete(key)) {
            dispatch(peer.serverId, peer.nick, { type: "reset" });
            return;
          }
          dispatch(peer.serverId, peer.nick, {
            type: "error",
            reason: "peer-ended",
          });
        },
        onError: (peer, error) => {
          // An OTR error/notice on a live session is informational (libotr
          // shows it but keeps the session); only a failure before the AKE
          // completes is fatal. Never downgrade an established session, or the
          // next message would silently leak as plaintext.
          const status =
            getStore()?.getState().e2eeSessions[
              convKey(peer.serverId, peer.nick)
            ]?.status;
          if (status === "established") return;
          backend?.end(peer);
          // The engine surfaces remote-supplied text here, and the reason is
          // rendered in the encryption banner, so a peer could otherwise write
          // its own prose into the surface the user consults to judge safety.
          console.warn("[OTR] session error:", error);
          dispatch(peer.serverId, peer.nick, {
            type: "error",
            reason: "handshake-failed",
          });
        },
      });
      backend = built;
      getStore()?.setState({ e2eeOtrSelfFingerprint: built.selfFingerprint() });
      return built;
    })
    // Drop the cached promise on failure (e.g. a worker/keygen error) so the
    // next OTR action retries instead of reusing a permanently-rejected one.
    .catch((err) => {
      backendPromise = null;
      throw err;
    });
  return backendPromise;
}

// Run an action against the backend once its lazy build resolves. A build
// failure surfaces as a session error rather than an unhandled rejection.
function withBackend(peer: OtrPeerRef, action: (b: OtrBackend) => void): void {
  buildBackend()
    .then(action)
    .catch(() => {
      dispatch(peer.serverId, peer.nick, {
        type: "error",
        reason: "encryption-unavailable",
      });
    });
}

export function startOtrSession(serverId: string, nick: string): void {
  const peer: OtrPeerRef = { serverId, nick };
  dispatch(serverId, nick, { type: "start", scheme: "otr" });
  // Arm the timeout only once the query is actually on the wire, so the lazy
  // keygen (~2s) doesn't eat into the negotiation window or fire before we sent.
  withBackend(peer, (b) => {
    b.start(peer);
    armNegotiationTimer(
      serverId,
      nick,
      () => backend?.end(peer),
      OTR_NEGOTIATION_TIMEOUT_MS,
    );
  });
}

// Returns true when `body` is OTR traffic (so the caller consumes it instead of
// rendering it as a chat message). The classify check is synchronous so the
// caller swallows immediately; the crypto runs async since the identity key may
// still be generating. `skipProcessing` swallows the frame without feeding it to
// the session — for our own echoed sends (echo-message) and for CHATHISTORY
// replays, neither of which should drive a live handshake.
export function handleInboundOtr(
  serverId: string,
  sender: string,
  body: string,
  skipProcessing = false,
): boolean {
  if (classifyInbound({ body }).scheme !== "otr") return false;
  // Consumed either way: an ignored peer's ciphertext must not fall through and
  // render as the raw ?OTR: body.
  if (skipProcessing || isE2EESenderIgnored(sender)) return true;
  const peer: OtrPeerRef = { serverId, nick: sender };
  const status =
    getStore()?.getState().e2eeSessions[convKey(serverId, sender)]?.status;
  // An unsolicited inbound session: reflect the auto-handshake (OTR has no
  // accept gate) as negotiating. Skipped once already negotiating/established so
  // mid-handshake frames don't re-arm the timer.
  const fresh =
    status !== "negotiating" &&
    status !== "established" &&
    status !== "key-changed";
  if (fresh) {
    ensurePrivateChat(serverId, sender);
    dispatch(serverId, sender, { type: "start", scheme: "otr" });
  }
  withBackend(peer, (b) => {
    b.receive(peer, body);
    if (fresh)
      armNegotiationTimer(
        serverId,
        sender,
        () => backend?.end(peer),
        OTR_NEGOTIATION_TIMEOUT_MS,
      );
    // If an established session silently left the encrypted state (peer ended
    // OTR / desync), correct the lock instead of leaving it green — otherwise
    // the next outgoing message would leak as plaintext under a trusted lock.
    const st =
      getStore()?.getState().e2eeSessions[convKey(serverId, sender)]?.status;
    if (st === "established" && !b.isEncrypting(peer)) {
      dispatch(serverId, sender, {
        type: "error",
        reason: "peer-ended",
      });
    }
  });
  return true;
}

// Encrypt and send an outgoing PM. The local echo only happens once the message
// is actually encrypted — if the session has dropped out of the encrypted state
// we must NOT fall back to plaintext under a lock the user still trusts; instead
// surface the loss and drop the message.
export function sendOtrMessage(
  serverId: string,
  nick: string,
  content: string,
): void {
  const peer: OtrPeerRef = { serverId, nick };
  withBackend(peer, (b) => {
    if (b.encrypt(peer, content)) {
      const self = getStore()?.getState().currentUser?.username ?? "";
      injectMessage(serverId, nick, self, content);
    } else {
      dispatch(serverId, nick, {
        type: "error",
        reason: "encryption-lost",
      });
    }
  });
}

export function endOtrSession(serverId: string, nick: string): void {
  clearNegotiationTimer(convKey(serverId, nick));
  locallyEnded.add(convKey(serverId, nick));
  backend?.end({ serverId, nick });
  dispatch(serverId, nick, { type: "reset" });
}

export function trustOtrChangedKey(serverId: string, nick: string): void {
  trustChangedKey(otrPeerTrust, serverId, nick);
}

// Persist the peer's fingerprint as verified (TOFU) so future sessions show it
// as trusted, and reflect it in the current session.
export function verifyOtrSession(serverId: string, nick: string): void {
  otrPeerTrust.setVerified(serverId, nick);
  dispatch(serverId, nick, { type: "verify" });
}
