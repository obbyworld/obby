import { describe, expect, it } from "vitest";
import { isSafeServiceUrl } from "../../src/lib/serviceUrl";

describe("isSafeServiceUrl", () => {
  it.each([
    "https://irc.example.org",
    "https://api.example.org/upload/",
    "https://files.example.org:8443",
    "http://localhost:8090",
    "http://127.0.0.1:7790/api",
    "http://[::1]:8080",
  ])("accepts %s", (url) => {
    expect(isSafeServiceUrl(url)).toBe(true);
  });

  it.each([
    "http://files.example.org",
    "http://127.evil.example",
    "http://localhost.evil.example",
    "http://10.0.2.2:8090",
    "http://192.168.1.20/upload",
    "file:///etc/passwd",
    "tauri://localhost/upload",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pass@files.example.org",
    "https://user@files.example.org",
    "//files.example.org",
    "/upload",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isSafeServiceUrl(url)).toBe(false);
  });
});
