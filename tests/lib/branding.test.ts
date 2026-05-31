import { describe, expect, test } from "vitest";
import { APP_NAME, APP_REPO_LABEL, APP_REPO_URL } from "../../src/lib/branding";

describe("branding", () => {
  test("exposes a non-empty app name", () => {
    expect(APP_NAME.length).toBeGreaterThan(0);
  });

  test("repo label is the repo URL without its scheme", () => {
    expect(APP_REPO_URL).toMatch(/^https?:\/\//);
    expect(APP_REPO_LABEL).toBe(APP_REPO_URL.replace(/^https?:\/\//, ""));
    expect(APP_REPO_LABEL).not.toMatch(/^https?:\/\//);
  });
});
