import { describe, expect, test, vi } from "vitest";
import { IRC_DISPATCH } from "../../../src/lib/irc/handlers";
import type { IRCClientContext } from "../../../src/lib/irc/IRCClientContext";

function failMetadata(params: string[], description: string) {
  const triggerEvent = vi.fn();
  const ctx = { triggerEvent } as unknown as IRCClientContext;
  IRC_DISPATCH.FAIL(
    ctx,
    "srv",
    "irc.example.com",
    ["METADATA", ...params, description],
    undefined,
    description,
  );
  return triggerEvent.mock.calls[0];
}

describe("FAIL METADATA", () => {
  test("reads the target after the code", () => {
    expect(
      failMetadata(["INVALID_TARGET", "gone"], "invalid metadata target"),
    ).toEqual([
      "METADATA_FAIL",
      {
        serverId: "srv",
        code: "INVALID_TARGET",
        target: "gone",
        key: undefined,
        retryAfter: undefined,
      },
    ]);
  });

  test("reads target, key and retry time of a rate limit", () => {
    expect(
      failMetadata(["RATE_LIMITED", "*", "avatar", "5"], "slow down")[1],
    ).toMatchObject({
      code: "RATE_LIMITED",
      target: "*",
      key: "avatar",
      retryAfter: 5,
    });
  });

  test("reads the key of a key-only failure", () => {
    expect(
      failMetadata(["KEY_INVALID", "bad!key"], "invalid key")[1],
    ).toMatchObject({ code: "KEY_INVALID", target: undefined, key: "bad!key" });
  });
});
