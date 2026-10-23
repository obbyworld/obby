import { describe, expect, it } from "vitest";
import { checkForUpdate, relaunchApp } from "../../src/lib/updater";

// In jsdom there is no window.__TAURI__, so isTauriDesktop() is false. These
// guards guarantee the web/Docker build never dynamically imports the desktop-
// only @tauri-apps/plugin-updater or plugin-process modules.
describe("updater off Tauri desktop", () => {
  it("checkForUpdate resolves to null", async () => {
    expect(await checkForUpdate()).toBeNull();
  });

  it("relaunchApp is a no-op", async () => {
    await expect(relaunchApp()).resolves.toBeUndefined();
  });
});
