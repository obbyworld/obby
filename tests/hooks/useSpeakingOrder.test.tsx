import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeakingOrder } from "../../src/hooks/useSpeakingOrder";
import type { VoiceMember } from "../../src/lib/voice";

function member(
  nick: string,
  overrides: Partial<VoiceMember> = {},
): VoiceMember {
  return {
    nick,
    micOn: true,
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

describe("useSpeakingOrder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the active speaker first", () => {
    const { result } = renderHook(() =>
      useSpeakingOrder([
        member("alice"),
        member("bob", { speaking: true }),
        member("carol"),
      ]),
    );
    expect(result.current[0].nick).toBe("bob");
  });

  it("ranks a more recently-stopped speaker above an older one", () => {
    const { result, rerender } = renderHook(
      ({ members }: { members: VoiceMember[] }) => useSpeakingOrder(members),
      {
        initialProps: {
          members: [member("alice", { speaking: true }), member("bob")],
        },
      },
    );

    vi.advanceTimersByTime(1000);
    rerender({ members: [member("alice"), member("bob")] }); // alice stops

    vi.advanceTimersByTime(1000);
    rerender({ members: [member("alice"), member("bob", { speaking: true })] });

    vi.advanceTimersByTime(1000);
    rerender({ members: [member("alice"), member("bob")] }); // bob stops, more recently

    expect(result.current.map((m) => m.nick)).toEqual(["bob", "alice"]);
  });

  it("keeps never-spoken members in their original order", () => {
    const { result } = renderHook(() =>
      useSpeakingOrder([member("carol"), member("alice"), member("bob")]),
    );
    expect(result.current.map((m) => m.nick)).toEqual([
      "carol",
      "alice",
      "bob",
    ]);
  });

  it("returns the same array identity when speaking state is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ members }: { members: VoiceMember[] }) => useSpeakingOrder(members),
      { initialProps: { members: [member("alice"), member("bob")] } },
    );
    const first = result.current;
    rerender({ members: [member("alice"), member("bob")] });
    expect(result.current).toBe(first);
  });
});
