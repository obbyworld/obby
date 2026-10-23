import { describe, expect, test, vi } from "vitest";
import { IRCClient } from "../../../src/lib/irc/IRCClient";

describe("multiline-concat boundary spaces", () => {
  test("keeps the trailing space of a concat part", () => {
    const client = new IRCClient();
    const onMultiline = vi.fn();
    client.on("MULTILINE_MESSAGE", onMultiline);
    const feed = (line: string) =>
      (
        client as unknown as {
          handleMessage: (data: string, serverId: string) => void;
        }
      ).handleMessage(`${line}\r\n`, "srv");

    feed(":bot!b@h BATCH +ml draft/multiline #lobby");
    feed("@batch=ml :bot!b@h PRIVMSG #lobby :the kernel ");
    feed("@batch=ml;draft/multiline-concat :bot!b@h PRIVMSG #lobby :delivers");
    feed(":bot!b@h BATCH -ml");

    expect(onMultiline).toHaveBeenCalledWith(
      expect.objectContaining({ message: "the kernel delivers" }),
    );
  });
});
