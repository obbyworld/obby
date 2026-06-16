import { describe, expect, test } from "vitest";
import { formatOtrFingerprint } from "../../../../src/lib/e2ee/otr/identity";

describe("formatOtrFingerprint", () => {
  test("groups 40 hex chars into five blocks of eight, matching libotr clients", () => {
    expect(
      formatOtrFingerprint("09d1d2fa51e7ca597a995059b1259e68c5167266"),
    ).toBe("09d1d2fa 51e7ca59 7a995059 b1259e68 c5167266");
  });

  test("returns the input unchanged when it cannot be grouped", () => {
    expect(formatOtrFingerprint("")).toBe("");
  });
});
