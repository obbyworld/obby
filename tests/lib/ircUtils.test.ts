import { describe, expect, it } from "vitest";
import {
  escapeTagValue,
  formatTags,
  parseMessageTags,
  replyTags,
  unescapeTagValue,
} from "../../src/lib/ircUtils";

describe("tag value escaping", () => {
  it("round-trips every character the tag section reserves", () => {
    const value = "a;b c\\d\re\nf\\s";
    expect(escapeTagValue(value)).toBe("a\\:b\\sc\\\\d\\re\\nf\\\\s");
    expect(unescapeTagValue(escapeTagValue(value))).toBe(value);
  });

  it("keeps a value with a line break inside one tag", () => {
    const line = `${formatTags({ "+draft/react": "x\nNICK pwned", "+reply": "m;1" })}TAGMSG #c`;
    expect(line).toBe("@+draft/react=x\\nNICK\\spwned;+reply=m\\:1 TAGMSG #c");
    expect(parseMessageTags(line.slice(0, line.indexOf(" ")))).toEqual({
      "+draft/react": "x\nNICK pwned",
      "+reply": "m;1",
    });
  });

  it("builds no prefix without a msgid to reply to", () => {
    expect(replyTags(undefined)).toBe("");
    expect(formatTags({})).toBe("");
  });
});
