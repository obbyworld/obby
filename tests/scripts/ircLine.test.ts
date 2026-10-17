import { describe, expect, it } from "vitest";
import { parseIrcLine, prefixNick } from "../../scripts/lib/ircLine.mjs";

describe("parseIrcLine", () => {
  it("parses a plain command with params and trailing", () => {
    const msg = parseIrcLine("JOIN ^test");
    expect(msg.command).toBe("JOIN");
    expect(msg.params).toEqual(["^test"]);
    expect(msg.prefix).toBe("");
    expect(msg.tags).toEqual({});
  });

  it("parses prefix, command and trailing", () => {
    const msg = parseIrcLine(":bob!bob@host PRIVMSG #chan :hello there");
    expect(msg.prefix).toBe("bob!bob@host");
    expect(msg.command).toBe("PRIVMSG");
    expect(msg.params).toEqual(["#chan", "hello there"]);
  });

  it("parses a numeric reply with multiple params", () => {
    const msg = parseIrcLine(":irc.example.com 001 mynick :Welcome");
    expect(msg.command).toBe("001");
    expect(msg.params).toEqual(["mynick", "Welcome"]);
  });

  it("parses tags and unescapes tag values", () => {
    const msg = parseIrcLine("@foo=a\\sb\\:c :bot!bot@host TAGMSG ^test");
    expect(msg.tags.foo).toBe("a b;c");
    expect(msg.command).toBe("TAGMSG");
    expect(msg.params).toEqual(["^test"]);
  });

  it("parses a bare tag with no value", () => {
    const msg = parseIrcLine("@bare :nick!u@h PRIVMSG #c :hi");
    expect(msg.tags.bare).toBe("");
  });

  it("handles CAP LS with a multiline marker", () => {
    const msg = parseIrcLine("CAP * LS * :message-tags batch");
    expect(msg.command).toBe("CAP");
    expect(msg.params).toEqual(["*", "LS", "*", "message-tags batch"]);
  });

  it("parses PING", () => {
    const msg = parseIrcLine("PING :abc123");
    expect(msg.command).toBe("PING");
    expect(msg.params).toEqual(["abc123"]);
  });
});

describe("prefixNick", () => {
  it("extracts the nick from a full user prefix", () => {
    expect(prefixNick("bob!bob@host.example.com")).toBe("bob");
  });

  it("returns the whole prefix when there's no user/host", () => {
    expect(prefixNick("irc.example.com")).toBe("irc.example.com");
  });
});
