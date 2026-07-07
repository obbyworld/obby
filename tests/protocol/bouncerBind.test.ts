import { beforeEach, describe, expect, test } from "vitest";
import { IRCClient } from "../../src/lib/irc/IRCClient";

// We don't need a real WS for this test — sendCapEnd / setPendingBouncerBind
// route through this.sendRaw, which we can mock at the class level.

describe("IRCClient sendCapEnd / pending BIND", () => {
  let client: IRCClient;
  let sent: string[];

  beforeEach(() => {
    client = new IRCClient();
    sent = [];
    // biome-ignore lint/suspicious/noExplicitAny: stub the raw send for assertion
    (client as any).sendRaw = (_id: string, line: string) => sent.push(line);
  });

  test("emits CAP END alone when no BIND is queued (regular connection)", () => {
    client.sendCapEnd("s1");
    expect(sent).toEqual(["CAP END"]);
  });

  test("emits BOUNCER BIND <netid> immediately before CAP END", () => {
    client.setPendingBouncerBind("s1", "42");
    client.sendCapEnd("s1");
    expect(sent).toEqual(["BOUNCER BIND 42", "CAP END"]);
  });

  test("BIND is consumed -- a follow-up sendCapEnd does not re-emit", () => {
    client.setPendingBouncerBind("s1", "42");
    client.sendCapEnd("s1");
    sent.length = 0;
    client.sendCapEnd("s1");
    expect(sent).toEqual(["CAP END"]);
  });

  test("BINDs are scoped per serverId", () => {
    client.setPendingBouncerBind("control", "");
    // s1 has no BIND queued; control would never get a BIND in
    // practice (empty netid would be wrong anyway), and crucially the
    // queue doesn't leak across serverIds.
    client.setPendingBouncerBind("child-a", "42");
    client.setPendingBouncerBind("child-b", "43");

    client.sendCapEnd("child-a");
    client.sendCapEnd("child-b");
    expect(sent).toEqual([
      "BOUNCER BIND 42",
      "CAP END",
      "BOUNCER BIND 43",
      "CAP END",
    ]);
  });
});
