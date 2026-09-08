import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// iOS terminates an app that touches the camera or microphone without a usage
// description, and Android refuses the capture without the manifest
// permissions, so a call fails on the device while every browser test passes.
// These files are generated, and a regeneration silently drops the keys.
describe("native builds can capture media", () => {
  test("iOS declares why it wants the camera and microphone", () => {
    const plist = read("src-tauri/gen/apple/Obby_iOS/Info.plist");
    expect(plist).toContain("NSCameraUsageDescription");
    expect(plist).toContain("NSMicrophoneUsageDescription");
  });

  test("macOS declares the same, and entitles itself to the devices", () => {
    const plist = read("src-tauri/Info.plist");
    expect(plist).toContain("NSCameraUsageDescription");
    expect(plist).toContain("NSMicrophoneUsageDescription");

    const entitlements = read("src-tauri/Entitlements.plist");
    expect(entitlements).toContain("com.apple.security.device.camera");
    expect(entitlements).toContain("com.apple.security.device.audio-input");
  });

  test("Android asks for the camera and microphone", () => {
    const manifest = read(
      "src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    );
    expect(manifest).toContain("android.permission.CAMERA");
    expect(manifest).toContain("android.permission.RECORD_AUDIO");
  });
});
