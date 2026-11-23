import { describe, expect, test } from "vitest";
import {
  chunkForMultiline,
  parseMultilineLimits,
  UNLIMITED_MULTILINE,
} from "../../../src/lib/irc/multiline";

describe("parseMultilineLimits", () => {
  test("reads what obbyircd advertises", () => {
    expect(parseMultilineLimits("max-bytes=5250,max-lines=15")).toEqual({
      maxBytes: 5250,
      maxLines: 15,
    });
  });

  test("a capability with no value states no limit", () => {
    expect(parseMultilineLimits(undefined)).toEqual(UNLIMITED_MULTILINE);
    expect(parseMultilineLimits("")).toEqual(UNLIMITED_MULTILINE);
  });

  test("an unreadable limit is ignored rather than believed", () => {
    expect(parseMultilineLimits("max-lines=nope,max-bytes=4096")).toEqual({
      maxLines: Number.POSITIVE_INFINITY,
      maxBytes: 4096,
    });
  });
});

describe("chunkForMultiline", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => [`l${i}`]);
  const text = (batch: string[][]) => batch.map((parts) => parts.join(""));

  test("a code fence cut by a batch break is closed and reopened", () => {
    const paste = [["```csharp"], ...lines(15), ["};"], ["```"], ["after"]];
    const batches = chunkForMultiline(paste, {
      maxLines: 15,
      maxBytes: 5250,
    });
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(15);
      const fences = text(batch).filter((l) => l.trim().startsWith("```"));
      expect(fences.length % 2).toBe(0);
    }
    expect(text(batches[0])[0]).toBe("```csharp");
    expect(text(batches[0]).at(-1)).toBe("```");
    expect(text(batches[1])[0]).toBe("```csharp");
    expect(batches.flatMap(text).filter((l) => !l.startsWith("```"))).toEqual(
      paste.map((p) => p[0]).filter((l) => !l.startsWith("```")),
    );
  });

  test("inline ```code``` opens no fence", () => {
    const batches = chunkForMultiline([["```inline```"], ["a"], ["b"]], {
      maxLines: 3,
      maxBytes: 5250,
    });
    expect(batches.map(text)).toEqual([["```inline```", "a", "b"]]);
  });

  test("a fence marker with text after it stays inside the code block", () => {
    const paste = [["```js"], ["```text"], ...lines(4), ["```"]];
    const batches = chunkForMultiline(paste, { maxLines: 4, maxBytes: 5250 });
    for (const batch of batches.slice(1)) {
      expect(text(batch)[0]).toBe("```js");
    }
  });

  test("a long line inside a fence still fits next to the reopened fence", () => {
    const paste = [["```js"], ["a", "b"], ["```"]];
    for (const batch of chunkForMultiline(paste, {
      maxLines: 3,
      maxBytes: 5250,
    })) {
      expect(batch.flat().length).toBeLessThanOrEqual(3);
    }
    const longLine = ["aaaa", "bbbb", "cccc", "dddd"];
    for (const batch of chunkForMultiline([["```js"], longLine, ["```"]], {
      maxLines: 15,
      maxBytes: 16,
    })) {
      expect(batch.flat().join("").length).toBeLessThanOrEqual(16);
    }
  });

  test("a paste without fences is chunked as before", () => {
    const batches = chunkForMultiline(lines(20), {
      maxLines: 15,
      maxBytes: 5250,
    });
    expect(batches.map((b) => b.length)).toEqual([15, 5]);
  });

  test("a paste past the line cap goes out as several batches", () => {
    const batches = chunkForMultiline(lines(20), {
      maxLines: 15,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    expect(batches.map((b) => b.length)).toEqual([15, 5]);
  });

  test("a line's parts stay in one batch, so concat never breaks", () => {
    const batches = chunkForMultiline([...lines(14), ["a", "b", "c"]], {
      maxLines: 15,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    expect(batches.map((b) => b.length)).toEqual([14, 1]);
    expect(batches[1][0]).toEqual(["a", "b", "c"]);
  });

  test("a line longer than a whole batch is split rather than dropped", () => {
    const batches = chunkForMultiline([["a", "b", "c", "d", "e"]], {
      maxLines: 2,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    expect(batches.flat()).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  test("a line past the byte ceiling is split, not sent over budget", () => {
    const parts = Array.from({ length: 6 }, () => "z".repeat(50));
    const batches = chunkForMultiline([parts], {
      maxLines: 15,
      maxBytes: 120,
    });
    const bytes = batches.map((b) =>
      b.flat().reduce((n, p) => n + p.length, 0),
    );
    expect(Math.max(...bytes)).toBeLessThanOrEqual(120);
  });

  test("the byte ceiling closes a batch too", () => {
    const batches = chunkForMultiline([["x".repeat(60)], ["y".repeat(60)]], {
      maxLines: 15,
      maxBytes: 100,
    });
    expect(batches).toHaveLength(2);
  });

  test("no limits means one batch", () => {
    expect(chunkForMultiline(lines(40), UNLIMITED_MULTILINE)).toHaveLength(1);
  });
});
