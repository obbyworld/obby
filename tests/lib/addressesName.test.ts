import { describe, expect, test } from "vitest";
import { addressesName } from "../../src/lib/notifications";

describe("addressesName", () => {
  test("the plain forms someone uses to address you", () => {
    expect(addressesName("mattf: look at this", "mattf")).toBe(true);
    expect(addressesName("hey @mattf look", "mattf")).toBe(true);
    expect(addressesName("thanks mattf", "mattf")).toBe(true);
    expect(addressesName("mattf, are you there", "mattf")).toBe(true);
    expect(addressesName("(mattf) said so", "mattf")).toBe(true);
    expect(addressesName("mattf", "mattf")).toBe(true);
  });

  test("case does not matter", () => {
    expect(addressesName("MattF: hi", "mattf")).toBe(true);
    expect(addressesName("hi mattf", "MATTF")).toBe(true);
  });

  // The whole point of the boundary: a name buried in a longer word is not
  // someone talking to you.
  test("a name inside a longer word is not being addressed", () => {
    expect(addressesName("mattfoo said hi", "mattf")).toBe(false);
    expect(addressesName("ask nomattf about it", "mattf")).toBe(false);
    expect(addressesName("premattfpost", "mattf")).toBe(false);
  });

  // These are legal nick characters, so a word boundary would wrongly split
  // here and light up for the wrong person.
  test("nick punctuation counts as part of the name", () => {
    expect(addressesName("mattf|away: hi", "mattf")).toBe(false);
    expect(addressesName("hi mattf_", "mattf")).toBe(false);
    expect(addressesName("hi mattf[m]", "mattf")).toBe(false);
    expect(addressesName("hi mattf-", "mattf")).toBe(false);
  });

  test("a name made of those characters is still found", () => {
    expect(addressesName("mattf|away: hi", "mattf|away")).toBe(true);
    expect(addressesName("hey [bot]: run it", "[bot]")).toBe(true);
    expect(addressesName("ping my-nick now", "my-nick")).toBe(true);
  });

  test("a short name only matches where it stands alone", () => {
    expect(addressesName("the corporation said no", "Ora")).toBe(false);
    expect(addressesName("Hey, Ora", "Ora")).toBe(true);
    expect(addressesName("@ora can you look", "Ora")).toBe(true);
    expect(addressesName("Let's ask Ora.", "Ora")).toBe(true);
  });

  test("a later occurrence still counts when the first is buried", () => {
    expect(addressesName("mattfoo told mattf about it", "mattf")).toBe(true);
  });

  test("an empty name is never addressed", () => {
    expect(addressesName("anything at all", "")).toBe(false);
    expect(addressesName("anything at all", "   ")).toBe(false);
  });
});
