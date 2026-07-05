import { t } from "@lingui/core/macro";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import { sendEncryptedMessage } from "./e2ee";
import { getStore, injectSystemNotice } from "./e2eeShared";
import { sendOtrMessage } from "./otr";

// Every outgoing-PM path funnels through here. "sent" = encrypted and away;
// "withheld" = dropped under an engaged-but-not-ready lock (caller should keep
// the user's draft); "none" = no session, caller sends plaintext.
export type PMRouteResult = "sent" | "withheld" | "none";

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

  // pending-accept means a peer offered us encryption we haven't accepted — an
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

  return "none";
}
