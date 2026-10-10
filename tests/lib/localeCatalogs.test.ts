import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES_DIR = join(__dirname, "../../src/locales");

// ICU MessageFormat reads an apostrophe before a brace as the start of quoted
// text, so `'{nick}'` renders the literal "{nick}" instead of the value.
describe("locale catalogs", () => {
  it("never puts an ASCII apostrophe right before a brace", () => {
    const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const offenders = locales.flatMap((locale) =>
      readFileSync(join(LOCALES_DIR, locale, "messages.po"), "utf8")
        .split("\n")
        .filter((line) => /^msg(id|str) /.test(line) && /'[{}]/.test(line))
        .map((line) => `${locale}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
