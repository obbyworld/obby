import { t } from "@lingui/core/macro";
import { e2eeSessionKey, isWithholding } from "../../lib/e2ee/session";
import { sendEncryptedMessage } from "./e2ee";
import { getStore, injectSystemNotice } from "./e2eeShared";
import { sendOtrMessage } from "./otr";

// Every outgoing-PM path funnels through here. "sent" = encrypted and away;
// "withheld" = dropped under an engaged-but-not-ready lock (caller should keep
// the user's draft); "none" = no session, caller sends plaintext.
export type PMRouteResult = "sent" | "withheld" | "none";

// What a non-text send (an upload) may do in this conversation. "blocked"
// covers the states where routeOutgoingPM withholds text: bytes reach the host
// before any message does, so a withheld conversation must not upload either.
// "unencryptable" is a live lock whose scheme has no frame for a file, where
// the user has to be asked before the bytes leave in the clear.
export type PMEncryptionPosture =
  | "encrypt"
  | "blocked"
  | "unencryptable"
  | "plain";

export function pmEncryptionPosture(
  serverId: string,
  nick: string,
): PMEncryptionPosture {
  const session =
    getStore()?.getState().e2eeSessions[e2eeSessionKey(serverId, nick)];
  if (!session) return "plain";
  // OTR encrypts the link text and nothing else, so a file under an OTR lock
  // reaches the host readable while the header still shows green.
  if (session.status === "established")
    return session.scheme === "obby" ? "encrypt" : "unencryptable";
  return isWithholding(session) ? "blocked" : "plain";
}

export function routeOutgoingPM(
  serverId: string,
  nick: string,
  content: string,
): PMRouteResult {
  const session =
    getStore()?.getState().e2eeSessions[e2eeSessionKey(serverId, nick)];
  if (!session) return "none";

  if (session.status === "established") {
    if (session.scheme === "otr") sendOtrMessage(serverId, nick, content);
    else sendEncryptedMessage(serverId, nick, content);
    return "sent";
  }

  // pending-accept means a peer offered us encryption we haven't accepted, and an
  // unchosen mode shouldn't block our plaintext, so only withhold once we've
  // opted in (negotiating) or on a key change we must not silently send past.
  if (session.status === "negotiating" || session.status === "key-changed") {
    injectSystemNotice(
      serverId,
      nick,
      session.status === "key-changed"
        ? t`Message not sent: the encryption key changed. Verify the new key or end encryption before sending in the clear.`
        : t`Message not sent: encryption isn't active yet. Wait for the lock to turn green, or end encryption to send unencrypted.`,
    );
    return "withheld";
  }

  // A session that broke after it was live leaves the user believing the chat
  // is still protected, so withhold rather than fall through to plaintext.
  if (session.status === "error" && session.wasEstablished) {
    injectSystemNotice(
      serverId,
      nick,
      t`Message not sent: encryption stopped working. End encryption to send unencrypted.`,
    );
    return "withheld";
  }

  return "none";
}
