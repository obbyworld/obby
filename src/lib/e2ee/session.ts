// The per-conversation E2EE lifecycle as a pure reducer, kept separate from the
// crypto/IO so it can be exhaustively unit-tested. The store handler drives it
// with events from the wire and the UI; the resulting status is what the lock
// button and security panel render. Invalid events for a given state are
// ignored (return the state unchanged) so out-of-order wire traffic can't wedge
// a conversation into an undefined state.

export type E2EEScheme = "obby" | "otr";

export type E2EESessionState =
  | { status: "none" }
  | {
      status: "negotiating";
      scheme: E2EEScheme;
      initiator: boolean;
      peerFingerprint?: string;
      peerAccount?: string;
    }
  | {
      status: "pending-accept";
      scheme: E2EEScheme;
      peerFingerprint: string;
      peerAccount?: string;
    }
  | {
      status: "established";
      scheme: E2EEScheme;
      verified: boolean;
      peerFingerprint: string;
      peerAccount?: string;
    }
  | { status: "rejected"; scheme: E2EEScheme }
  | {
      status: "key-changed";
      scheme: E2EEScheme;
      oldFingerprint: string;
      newFingerprint: string;
    }
  // `wasEstablished` marks a session that broke after it was live (peer ended
  // it, desync, key loss). The send path withholds in that case so a message
  // the user typed under a green lock never goes out in the clear.
  | { status: "error"; reason: string; wasEstablished?: boolean };

export type E2EEEvent =
  | { type: "start"; scheme: E2EEScheme }
  | {
      type: "offer-received";
      scheme: E2EEScheme;
      peerFingerprint: string;
      peerAccount?: string;
    }
  | { type: "accept-local" }
  | { type: "reject-local" }
  | { type: "accepted-remote"; peerFingerprint: string; peerAccount?: string }
  | { type: "rejected-remote" }
  | { type: "established" }
  | { type: "verify" }
  | { type: "key-change"; oldFingerprint: string; newFingerprint: string }
  | { type: "error"; reason: string }
  | { type: "reset" };

export const INITIAL_SESSION: E2EESessionState = { status: "none" };

export function reduceSession(
  state: E2EESessionState,
  event: E2EEEvent,
): E2EESessionState {
  // reset and error are valid from any state — a user can always tear down a
  // session, and a backend failure always surfaces.
  if (event.type === "reset") return INITIAL_SESSION;
  if (event.type === "error")
    return {
      status: "error",
      reason: event.reason,
      wasEstablished: state.status === "established",
    };

  switch (state.status) {
    case "none":
    case "rejected":
    case "error":
      if (event.type === "start")
        return { status: "negotiating", scheme: event.scheme, initiator: true };
      if (event.type === "offer-received")
        return {
          status: "pending-accept",
          scheme: event.scheme,
          peerFingerprint: event.peerFingerprint,
          peerAccount: event.peerAccount,
        };
      return state;

    case "pending-accept":
      if (event.type === "accept-local")
        return {
          status: "negotiating",
          scheme: state.scheme,
          initiator: false,
          peerFingerprint: state.peerFingerprint,
          peerAccount: state.peerAccount,
        };
      if (event.type === "reject-local")
        return { status: "rejected", scheme: state.scheme };
      return state;

    case "negotiating":
      if (event.type === "accepted-remote")
        return {
          status: "established",
          scheme: state.scheme,
          verified: false,
          peerFingerprint: event.peerFingerprint,
          peerAccount: event.peerAccount,
        };
      if (event.type === "established" && state.peerFingerprint)
        return {
          status: "established",
          scheme: state.scheme,
          verified: false,
          peerFingerprint: state.peerFingerprint,
          peerAccount: state.peerAccount,
        };
      if (event.type === "rejected-remote")
        return { status: "rejected", scheme: state.scheme };
      return state;

    case "established":
      if (event.type === "verify") return { ...state, verified: true };
      if (event.type === "key-change")
        return {
          status: "key-changed",
          scheme: state.scheme,
          oldFingerprint: event.oldFingerprint,
          newFingerprint: event.newFingerprint,
        };
      return state;

    case "key-changed":
      // The only way out is an explicit reset (re-handshake): we never silently
      // re-encrypt to a changed key.
      return state;

    default:
      return state;
  }
}

// The key for a conversation's E2EE session, shared by the store, the
// orchestration, and the lock/banner UI. Single source of truth so the
// case-folding never drifts between a write and a lookup.
export function e2eeSessionKey(serverId: string, nick: string): string {
  return `${serverId}:${nick.toLowerCase()}`;
}
