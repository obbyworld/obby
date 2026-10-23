import { beforeEach, describe, expect, it } from "vitest";
import { e2eeSessionKey } from "../../src/lib/e2ee/session";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";

// Ratchet keys live only in memory, so a dropped connection can't keep an
// honest lock. The connection handler tears sessions down on disconnect rather
// than leave a green lock that no longer protects anything.
function established(scheme: "obby" | "otr") {
  return {
    status: "established" as const,
    scheme,
    verified: false,
    peerFingerprint: "fp",
  };
}

describe("e2ee sessions on disconnect", () => {
  beforeEach(() => {
    useStore.setState({ servers: [], e2eeSessions: {} });
  });

  it("resets the disconnected server's sessions and leaves other servers alone", () => {
    useStore.setState({
      e2eeSessions: {
        [e2eeSessionKey("srv-1", "bob")]: established("obby"),
        [e2eeSessionKey("srv-1", "carol")]: established("otr"),
        [e2eeSessionKey("srv-2", "dave")]: established("obby"),
      },
    });

    ircClient.triggerEvent("connectionStateChange", {
      serverId: "srv-1",
      connectionState: "disconnected",
    });

    const sessions = useStore.getState().e2eeSessions;
    expect(sessions[e2eeSessionKey("srv-1", "bob")]).toEqual({
      status: "none",
    });
    expect(sessions[e2eeSessionKey("srv-1", "carol")]).toEqual({
      status: "none",
    });
    expect(sessions[e2eeSessionKey("srv-2", "dave")].status).toBe(
      "established",
    );
  });
});
