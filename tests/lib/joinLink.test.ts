import { describe, expect, it } from "vitest";
import { hostnameOf, parseJoinLink } from "../../src/lib/joinLink";

describe("parseJoinLink", () => {
  it.each([
    [
      "#irc.example.org#lobby",
      { host: "wss://irc.example.org", port: 443, channels: ["#lobby"] },
    ],
    [
      "#wss://irc.example.org:8097/ws#lobby,#dev?nick=guest",
      {
        host: "wss://irc.example.org:8097/ws",
        port: 8097,
        channels: ["#lobby", "#dev"],
        nick: "guest",
      },
    ],
    [
      "#ircs://irc.example.org:6697/lobby,dev",
      {
        host: "wss://irc.example.org",
        port: 443,
        channels: ["#lobby", "#dev"],
      },
    ],
    [
      "#Example|wss://irc.example.org%23lobby",
      { host: "wss://irc.example.org", port: 443, channels: ["#lobby"] },
    ],
    [
      "#irc.example.org",
      { host: "wss://irc.example.org", port: 443, channels: [] },
    ],
    [
      "#irc.example.org#caf%C3%A9",
      { host: "wss://irc.example.org", port: 443, channels: ["#café"] },
    ],
    [
      "#irc.example.org#room%3Fa,#room%23b,#100%25",
      {
        host: "wss://irc.example.org",
        port: 443,
        channels: ["#room?a", "#room#b", "#100%"],
      },
    ],
  ])("parses %s", (fragment, expected) => {
    expect(parseJoinLink(fragment)).toEqual({ nick: undefined, ...expected });
  });

  it.each(["", "#", "#wss://", "#%E0%A4%A"])("rejects %j", (fragment) => {
    expect(parseJoinLink(fragment)).toBeNull();
  });
});

describe("hostnameOf", () => {
  it.each([
    ["wss://IRC.example.org:443/ws", "irc.example.org"],
    ["ircs://irc.example.org:6697", "irc.example.org"],
    ["irc.example.org", "irc.example.org"],
    ["wss://[2001:db8::1]:8000", "[2001:db8::1]"],
  ])("reads %s", (host, expected) => {
    expect(hostnameOf(host)).toBe(expected);
  });
});
