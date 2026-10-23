import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    on: vi.fn(),
    deleteHook: vi.fn(),
    sendRaw: vi.fn(),
    getCurrentUser: vi.fn(() => null),
  },
}));

import {
  acquireVoiceClient,
  attachLiveVoiceClient,
  getLiveVoiceCalls,
  releaseVoiceClient,
  shutdownAllVoiceClients,
  subscribeLiveVoiceCalls,
} from "../../src/lib/voice";
import { setTheater, useTheater } from "../../src/lib/voiceSpotlight";

function noop() {}

function acquire(serverId: string, channel: string) {
  return acquireVoiceClient({
    serverId,
    channel,
    selfNick: "me",
    onState: noop,
    onError: noop,
  });
}

describe("live voice call registry", () => {
  beforeEach(() => {
    shutdownAllVoiceClients();
  });

  it("forgets a call's theater layout once the call is released", () => {
    acquire("s1", "$stage");
    setTheater("s1", "$stage", true);
    const { result } = renderHook(() => useTheater("s1", "$stage"));
    expect(result.current[0]).toBe(true);

    act(() => releaseVoiceClient("s1", "$stage"));

    expect(result.current[0]).toBe(false);
  });

  it("starts empty", () => {
    expect(getLiveVoiceCalls()).toEqual([]);
  });

  it("adds an entry on acquire and removes it on release", () => {
    acquire("s1", "^general");
    expect(getLiveVoiceCalls()).toEqual([
      { serverId: "s1", channel: "^general" },
    ]);
    releaseVoiceClient("s1", "^general");
    expect(getLiveVoiceCalls()).toEqual([]);
  });

  it("lets a pop-out attach to a running call without reviving an ended one", () => {
    acquire("s1", "^general");
    acquire("s1", "$stage");

    const stale = attachLiveVoiceClient({
      serverId: "s1",
      channel: "^general",
      selfNick: "me",
      onState: noop,
      onError: noop,
    });

    expect(stale).toBeNull();
    expect(getLiveVoiceCalls()).toEqual([
      { serverId: "s1", channel: "$stage" },
    ]);
    expect(
      attachLiveVoiceClient({
        serverId: "s1",
        channel: "$stage",
        selfNick: "me",
        onState: noop,
        onError: noop,
      }),
    ).not.toBeNull();
  });

  it("keeps only one call, ending whichever was already running", () => {
    acquire("s1", "^general");
    acquire("s1", "$stage");

    expect(getLiveVoiceCalls()).toEqual([
      { serverId: "s1", channel: "$stage" },
    ]);
  });

  it("ends a call on another server too", () => {
    acquire("s1", "^general");
    acquire("s2", "^other");

    expect(getLiveVoiceCalls()).toEqual([
      { serverId: "s2", channel: "^other" },
    ]);
  });

  it("returns a stable reference when nothing changed", () => {
    acquire("s1", "^general");
    const first = getLiveVoiceCalls();
    const second = getLiveVoiceCalls();
    expect(first).toBe(second);
    releaseVoiceClient("s1", "^general");
  });

  it("does not duplicate an entry when a view re-acquires the same call", () => {
    acquire("s1", "^general");
    acquire("s1", "^general");
    expect(getLiveVoiceCalls()).toEqual([
      { serverId: "s1", channel: "^general" },
    ]);
    releaseVoiceClient("s1", "^general");
  });

  it("notifies subscribers on acquire, release, and shutdown", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveVoiceCalls(listener);

    acquire("s1", "^general");
    expect(listener).toHaveBeenCalledTimes(1);

    releaseVoiceClient("s1", "^general");
    expect(listener).toHaveBeenCalledTimes(2);

    acquire("s1", "^general");
    expect(listener).toHaveBeenCalledTimes(3);

    shutdownAllVoiceClients();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(getLiveVoiceCalls()).toEqual([]);

    unsubscribe();
  });
});
