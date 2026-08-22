import { beforeEach, describe, expect, test } from "vitest";
import useStore from "../../src/store";
import { pmEncryptionPosture } from "../../src/store/handlers/e2eeOutbound";
import { setStore } from "../../src/store/handlers/e2eeShared";

const serverId = "s1";
const nick = "bob";
const key = `${serverId}:${nick.toLowerCase()}`;

function withSession(session: unknown) {
  useStore.setState({
    e2eeSessions: session ? ({ [key]: session } as never) : ({} as never),
  });
}

// An upload puts bytes on the filehost before any message is sent, so the
// decision has to match what routeOutgoingPM does with text in the same state.
describe("upload posture tracks the text send rule", () => {
  beforeEach(() => setStore(useStore));

  test("a live Obby session encrypts", () => {
    withSession({
      status: "established",
      scheme: "obby",
      verified: false,
      peerFingerprint: "FP",
    });
    expect(pmEncryptionPosture(serverId, nick)).toBe("encrypt");
  });

  // OTR encrypts the text of the link and nothing else, so the header shows a
  // green lock over a file the host can read. That needs asking, not assuming.
  test("a live OTR session cannot encrypt a file", () => {
    withSession({
      status: "established",
      scheme: "otr",
      verified: false,
      peerFingerprint: "FP",
    });
    expect(pmEncryptionPosture(serverId, nick)).toBe("unencryptable");
  });

  test("a handshake in flight blocks the upload", () => {
    withSession({ status: "negotiating", scheme: "obby", initiator: true });
    expect(pmEncryptionPosture(serverId, nick)).toBe("blocked");
  });

  test("a changed key blocks the upload", () => {
    withSession({
      status: "key-changed",
      scheme: "obby",
      oldFingerprint: "FP",
      newFingerprint: "FP2",
    });
    expect(pmEncryptionPosture(serverId, nick)).toBe("blocked");
  });

  test("a session that broke after being live blocks the upload", () => {
    withSession({
      status: "error",
      reason: "encryption-lost",
      wasEstablished: true,
    });
    expect(pmEncryptionPosture(serverId, nick)).toBe("blocked");
  });

  test("a handshake that never completed uploads plainly", () => {
    withSession({
      status: "error",
      reason: "no-response",
      wasEstablished: false,
    });
    expect(pmEncryptionPosture(serverId, nick)).toBe("plain");
  });

  test("no session uploads plainly", () => {
    withSession(null);
    expect(pmEncryptionPosture(serverId, nick)).toBe("plain");
  });
});
