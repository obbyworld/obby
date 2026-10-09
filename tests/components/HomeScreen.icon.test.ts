import { describe, expect, it } from "vitest";
import {
  parseNetworkStats,
  serverIconUrl,
} from "../../src/components/ui/HomeScreen";

describe("serverIconUrl", () => {
  it("resolves repo-relative icons against the server list", () => {
    expect(serverIconUrl("server-icons/h4ks-com.png")).toBe(
      "https://raw.githubusercontent.com/obbyworld/server-list/refs/heads/main/server-icons/h4ks-com.png",
    );
  });

  it("refuses icons that leave the server list repo", () => {
    expect(serverIconUrl("https://evil.example/x.png")).toBeNull();
    expect(serverIconUrl("//evil.example/x.png")).toBeNull();
    expect(serverIconUrl("../../../other/repo/x.png")).toBeNull();
    expect(serverIconUrl(undefined)).toBeNull();
  });
});

describe("parseNetworkStats", () => {
  it("reads users and channels from the netsplit sentence", () => {
    expect(
      parseNetworkStats(
        "323 users, 233 channels on average (via netsplit.de).",
      ),
    ).toEqual({ users: 323, channels: 233 });
  });

  it("leaves a written description alone", () => {
    expect(parseNetworkStats("A cool place for tech talk.")).toBeNull();
  });
});
