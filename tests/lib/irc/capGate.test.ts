import { describe, expect, test } from "vitest";
import { capsRequiredFor } from "../../../src/lib/irc/capGate";

describe("capsRequiredFor", () => {
  test("plain commands need nothing", () => {
    expect(capsRequiredFor("PRIVMSG #a :hi")).toEqual([]);
    expect(capsRequiredFor("JOIN #a")).toEqual([]);
  });

  test("tags need message-tags plus the tag's own cap", () => {
    expect(capsRequiredFor("@+typing=active TAGMSG #a")).toEqual([
      "message-tags",
    ]);
    expect(capsRequiredFor("@+draft/bot-cmds-query TAGMSG bot")).toEqual([
      "message-tags",
      "draft/bot-cmds",
    ]);
  });

  test("gated commands need their cap, any case", () => {
    expect(capsRequiredFor("METADATA * GET avatar")).toEqual([
      "draft/metadata-2",
    ]);
    expect(capsRequiredFor("setname :x")).toEqual(["setname"]);
  });
});
