import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceMember, VoiceViewCallbacks } from "../../src/lib/voice";

const mocks = vi.hoisted(() => ({
  acquireVoiceClient: vi.fn(),
  releaseVoiceClient: vi.fn(),
}));

vi.mock("../../src/lib/voice", () => ({
  acquireVoiceClient: mocks.acquireVoiceClient,
  releaseVoiceClient: mocks.releaseVoiceClient,
}));

vi.mock("../../src/lib/ircClient", () => ({
  default: { getCurrentUser: vi.fn(() => ({ username: "me" })) },
}));

import { useVoiceCall } from "../../src/hooks/useVoiceCall";

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

describe("useVoiceCall", () => {
  const detach = vi.fn();
  const fakeClient = { getState: vi.fn(() => ({ phase: "idle" as const })) };
  let callbacks: VoiceViewCallbacks | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = undefined;
    mocks.acquireVoiceClient.mockImplementation((opts: VoiceViewCallbacks) => {
      callbacks = opts;
      return { client: fakeClient, detach };
    });
  });

  it("acquires a client keyed on serverId/channel/selfNick", () => {
    const { result } = renderHook(() => useVoiceCall("s1", "^general"));
    expect(mocks.acquireVoiceClient).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "s1",
        channel: "^general",
        selfNick: "me",
      }),
    );
    expect(result.current.client).toBe(fakeClient);
    expect(result.current.state).toEqual({ phase: "idle" });
  });

  it("flows onState updates into derived member lists", () => {
    const { result } = renderHook(() => useVoiceCall("s1", "^general"));
    act(() => {
      callbacks?.onState({
        phase: "connected",
        members: { me: member("me"), bob: member("bob") },
        mode: "voice",
        role: "streamer",
        streamers: ["me", "bob"],
      });
    });
    expect(result.current.state.phase).toBe("connected");
    expect(result.current.members).toHaveLength(2);
    expect(result.current.self?.nick).toBe("me");
    expect(result.current.streamerMembers).toHaveLength(2);
    expect(result.current.viewerMembers).toHaveLength(0);
  });

  it("splits streamers and viewers in a stream room and marks the host", () => {
    const { result } = renderHook(() => useVoiceCall("s1", "$stage"));
    act(() => {
      callbacks?.onState({
        phase: "connected",
        members: { me: member("me"), viewer1: member("viewer1") },
        mode: "stream",
        role: "streamer",
        streamers: ["me"],
      });
    });
    expect(result.current.isStreamRoom).toBe(true);
    expect(result.current.isHost).toBe(true);
    expect(result.current.streamerMembers.map((m) => m.nick)).toEqual(["me"]);
    expect(result.current.viewerMembers.map((m) => m.nick)).toEqual([
      "viewer1",
    ]);
  });

  it("surfaces errors and clears them on demand", () => {
    const { result } = renderHook(() => useVoiceCall("s1", "^general"));
    act(() => callbacks?.onError("server"));
    expect(result.current.error).toBe("server");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("expires a reaction 2400ms after it arrives", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceCall("s1", "^general"));
    act(() => callbacks?.onReaction?.("bob", "\u{1F44D}"));
    expect(result.current.reactions).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(result.current.reactions).toHaveLength(0);
    vi.useRealTimers();
  });

  it("detaches on unmount and never releases the call", () => {
    const { unmount } = renderHook(() => useVoiceCall("s1", "^general"));
    unmount();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(mocks.releaseVoiceClient).not.toHaveBeenCalled();
  });
});
