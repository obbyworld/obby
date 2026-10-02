import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "../../src/lib/ircUtils";

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(
      decodeHtmlEntities("&quot;OwO what&#39;s this&quot; &amp; it&#x2019;s"),
    ).toBe('"OwO what\'s this" & it’s');
  });

  it("decodes each entity once", () => {
    expect(decodeHtmlEntities("&amp;quot;")).toBe("&quot;");
  });

  it("keeps unknown entities as written", () => {
    expect(decodeHtmlEntities("&bogus; &#99999999;")).toBe(
      "&bogus; &#99999999;",
    );
  });
});
