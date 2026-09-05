import { describe, expect, it } from "vitest";
import { pickPipMember } from "../../../src/components/voice/pickPipMember";
import type { VoiceMember } from "../../../src/lib/voice";

function member(
  nick: string,
  overrides: Partial<VoiceMember> = {},
): VoiceMember {
  return {
    nick,
    micOn: false,
    videoOn: false,
    speaking: false,
    deafened: false,
    screenSharing: false,
    handRaised: false,
    volume: 1,
    quality: "unknown",
    ...overrides,
  };
}

describe("pickPipMember", () => {
  it("prefers a screen share over the ordered-first member and the spotlight", () => {
    const ordered = [
      member("carl", { speaking: true }),
      member("bob", { screenSharing: true }),
      member("alice"),
    ];
    expect(pickPipMember(ordered, "me", "alice")?.nick).toBe("bob");
  });

  it("prefers the shared spotlight over the ordered-first member", () => {
    const ordered = [member("carl", { speaking: true }), member("alice")];
    expect(pickPipMember(ordered, "me", "alice")?.nick).toBe("alice");
  });

  it("ignores a spotlight nick who isn't in the call", () => {
    const ordered = [member("carl"), member("alice")];
    expect(pickPipMember(ordered, "me", "ghost")?.nick).toBe("carl");
  });

  it("falls back to the first member in speaking order", () => {
    const ordered = [member("carl", { speaking: true }), member("alice")];
    expect(pickPipMember(ordered, "me")?.nick).toBe("carl");
  });

  it("falls back to any other member", () => {
    const ordered = [member("alice")];
    expect(pickPipMember(ordered, "me")?.nick).toBe("alice");
  });

  it("falls back to self when alone in the call", () => {
    const ordered = [member("me")];
    expect(pickPipMember(ordered, "me")?.nick).toBe("me");
  });

  it("returns undefined for an empty call", () => {
    expect(pickPipMember([], "me")).toBeUndefined();
  });
});
