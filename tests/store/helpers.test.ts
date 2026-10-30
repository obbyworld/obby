import { describe, expect, it } from "vitest";
import { hostnameOf, resolveUserMetadata } from "../../src/store/helpers";
import type { Channel } from "../../src/types";

function makeChannel(
  name: string,
  users: {
    username: string;
    metadata?: Record<
      string,
      { value: string | undefined; visibility: string }
    >;
  }[] = [],
): Channel {
  return {
    id: `ch-${name}`,
    name,
    isPrivate: false,
    serverId: "srv-1",
    unreadCount: 0,
    isMentioned: false,
    messages: [],
    users: users.map((u) => ({ id: `${u.username}-id`, isOnline: true, ...u })),
  };
}

const AVATAR = {
  value: "http://cdn.example.com/avatar.png",
  visibility: "public",
};
const META = { avatar: AVATAR };

describe("resolveUserMetadata", () => {
  it("returns localStorage metadata when present", () => {
    const serverMeta = { bob: META };
    const result = resolveUserMetadata("bob", serverMeta, []);
    expect(result).toEqual(META);
  });

  it("falls back to cross-channel metadata when localStorage has no entry", () => {
    const channels = [
      makeChannel("#other", [{ username: "bob", metadata: META }]),
    ];
    const result = resolveUserMetadata("bob", undefined, channels);
    expect(result).toEqual(META);
  });

  it("skips excludeChannelName in cross-channel search", () => {
    const channels = [
      makeChannel("#target", [{ username: "bob", metadata: META }]),
      makeChannel("#other", [{ username: "bob" }]),
    ];
    // Only #target has metadata for bob but it's excluded
    const result = resolveUserMetadata("bob", undefined, channels, "#target");
    expect(result).toEqual({});
  });

  it("returns {} when neither localStorage nor cross-channel has metadata", () => {
    const channels = [makeChannel("#general", [{ username: "bob" }])];
    const result = resolveUserMetadata("bob", {}, channels);
    expect(result).toEqual({});
  });

  it("cross-channel lookup is case-insensitive on username", () => {
    const channels = [
      makeChannel("#general", [{ username: "Bob", metadata: META }]),
    ];
    const result = resolveUserMetadata("bob", undefined, channels);
    expect(result).toEqual(META);
  });

  it("prefers localStorage over cross-channel", () => {
    const localMeta = {
      avatar: { value: "http://local.example.com/a.png", visibility: "public" },
    };
    const channelMeta = {
      avatar: {
        value: "http://channel.example.com/a.png",
        visibility: "public",
      },
    };
    const channels = [
      makeChannel("#general", [{ username: "bob", metadata: channelMeta }]),
    ];
    const result = resolveUserMetadata("bob", { bob: localMeta }, channels);
    expect(result).toEqual(localMeta);
  });
});

describe("hostnameOf", () => {
  it("drops the scheme, port and path and keeps a bracketed IPv6 host whole", () => {
    expect(hostnameOf("wss://irc.example.com:443/ws")).toBe("irc.example.com");
    expect(hostnameOf("irc.example.com:6697")).toBe("irc.example.com");
    expect(hostnameOf("[2001:db8::1]")).toBe("[2001:db8::1]");
    expect(hostnameOf("ircs://[2001:db8::1]:6697")).toBe("[2001:db8::1]");
  });
});
