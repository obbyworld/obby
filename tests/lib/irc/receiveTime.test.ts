import { afterEach, describe, expect, test, vi } from "vitest";
import { IRCClient } from "../../../src/lib/irc/IRCClient";

const feed = (client: IRCClient, line: string) =>
  (
    client as unknown as {
      handleMessage: (data: string, serverId: string) => void;
    }
  ).handleMessage(`${line}\r\n`, "srv");

afterEach(() => vi.useRealTimers());

describe("receive time", () => {
  test("a line without server-time carries one time for the chat and the saved history", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-14T10:00:00.000Z") });
    const client = new IRCClient();
    const onMessage = vi.fn();
    const onParsed = vi.fn();
    client.on("CHANMSG", onMessage);
    client.on("parsedLine", (parsed) => {
      onParsed(parsed);
      vi.advanceTimersByTime(5);
    });

    feed(client, ":alice!a@h PRIVMSG #lobby :hi");
    vi.advanceTimersByTime(5);

    const time = onParsed.mock.calls[0][0].mtags.time;
    expect(time).toBe("2026-10-14T10:00:00.000Z");
    expect(onMessage.mock.calls[0][0].timestamp.toISOString()).toBe(time);
  });

  test("a server-time tag stays as the server sent it", () => {
    const client = new IRCClient();
    const onParsed = vi.fn();
    client.on("parsedLine", onParsed);

    feed(
      client,
      "@time=2020-01-01T00:00:00.000Z :alice!a@h PRIVMSG #lobby :hi",
    );

    expect(onParsed.mock.calls[0][0].mtags.time).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });
});
