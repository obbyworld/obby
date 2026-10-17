import { describe, expect, test, vi } from "vitest";

// The registry indexes every setting while its module is imported, which
// happens before the app activates a locale. Asking Lingui to translate at
// that point throws and takes the whole app down at startup, so the index has
// to be built from source text alone.
vi.mock("@lingui/core", () => ({
  i18n: {
    locale: "",
    _: () => {
      throw new Error(
        "Lingui: Attempted to call a translation function without setting a locale.",
      );
    },
  },
}));

describe("settings registry builds before a locale is active", () => {
  test("registering does not need an active locale", async () => {
    const { settingsRegistry } = await import("../../src/lib/settings");

    expect(() =>
      settingsRegistry.register({
        id: "boot.probe",
        key: "bootProbe",
        category: "advanced",
        title: { id: "abc123", message: "Boot Probe" },
        type: "toggle",
        defaultValue: false,
      }),
    ).not.toThrow();

    expect(
      settingsRegistry.search("boot probe").map((r) => r.setting.id),
    ).toContain("boot.probe");
  });
});
