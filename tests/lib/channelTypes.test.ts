import { describe, expect, test } from "vitest";
import { IRCClient } from "../../src/lib/irc/IRCClient";
import { chantypesOf, isChannelTarget } from "../../src/lib/ircUtils";

const withChantypes = (value: string) =>
  new Map<string, string>([["CHANTYPES", value]]);

describe("channel types", () => {
  test.each([
    "#lobby",
    "&local",
    "+modeless",
    "!safe",
    "^voice",
    "$stream",
  ])("%s is a channel when the server's CHANTYPES is unknown", (name) =>
    expect(isChannelTarget(name)).toBe(true));

  test.each([
    "alice",
    "[bot]",
    "_x",
    "",
    undefined,
  ])("%s is not a channel", (name) =>
    expect(isChannelTarget(name)).toBe(false));

  test("the server's CHANTYPES decides", () => {
    expect(isChannelTarget("^nick", "#")).toBe(false);
    expect(isChannelTarget("$stream", "#^$")).toBe(true);
    expect(isChannelTarget("&local", "#^$")).toBe(false);
  });

  test("an empty or missing CHANTYPES falls back to every known prefix", () => {
    expect(chantypesOf(withChantypes(""))).toBe("#&+!^$");
    expect(chantypesOf(undefined)).toBe("#&+!^$");
    expect(chantypesOf(withChantypes("#^$"))).toBe("#^$");
  });

  test("the client reads CHANTYPES per server", () => {
    const client = new IRCClient();
    client.isupportValues.set("obby", withChantypes("#^$"));
    client.isupportValues.set("ergo", withChantypes("#"));

    expect(client.isChannel("obby", "^voice")).toBe(true);
    expect(client.isChannel("ergo", "^voice")).toBe(false);
    expect(client.isChannel("unknown", "+chan")).toBe(true);
  });
});
