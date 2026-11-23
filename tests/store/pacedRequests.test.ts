import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/store";
import {
  clearPacedRequests,
  dropPacedRequest,
  sendNowIfQueued,
  sendOpenChatFirst,
  sendPaced,
} from "../../src/store/pacedRequests";

const SERVER = "srv";

function queueTargets(targets: string[]) {
  const sent: string[] = [];
  for (const target of targets)
    sendPaced(SERVER, target, () => sent.push(target));
  return sent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  clearPacedRequests(SERVER);
  clearPacedRequests("other");
  vi.useRealTimers();
});

describe("pacing startup requests", () => {
  it("sends a first batch of four, then one per second", () => {
    const sent = queueTargets(["#a", "#b", "#c", "#d", "#e", "#f"]);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(sent).toEqual(["#a", "#b", "#c", "#d"]);
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "#e"]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "#e", "#f"]);
  });

  it("sends an opened chat right away and only once", () => {
    const sent = queueTargets(["#a", "#b", "#c", "#d", "#e", "#f"]);
    vi.advanceTimersByTime(0);
    expect(sendNowIfQueued(SERVER, "#F")).toBe(true);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "#f"]);
    expect(sendNowIfQueued(SERVER, "#f")).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "#f", "#e"]);
  });

  it("forgets a channel the user left before its turn", () => {
    const sent = queueTargets(["#a", "#b", "#c", "#d", "#e", "#f"]);
    vi.advanceTimersByTime(0);
    dropPacedRequest(SERVER, "#E");
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "#f"]);
  });

  it("queues a target once", () => {
    const sent = queueTargets(["#a", "#A", "#a"]);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["#a"]);
  });

  it("drops a server's queue when its connection changes", () => {
    const sent = queueTargets(["#a", "#b", "#c", "#d", "#e", "#f"]);
    sendPaced("other", "#x", () => sent.push("other #x"));
    vi.advanceTimersByTime(0);
    clearPacedRequests(SERVER);
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "other #x"]);
  });

  it("paces each server on its own", () => {
    const sent = queueTargets(["#a", "#b", "#c", "#d", "#e"]);
    for (const target of ["#x", "#y"])
      sendPaced("other", target, () => sent.push(`other ${target}`));
    vi.advanceTimersByTime(0);
    expect(sent).toEqual(["#a", "#b", "#c", "#d", "other #x", "other #y"]);
  });

  it("sends the open chat right away and queues the others", () => {
    const state = {
      servers: [
        {
          id: SERVER,
          channels: [
            { id: "c1", name: "#open" },
            { id: "c2", name: "#closed" },
          ],
          privateChats: [],
        },
      ],
      ui: { perServerSelections: { [SERVER]: { selectedChannelId: "c1" } } },
    } as unknown as AppState;
    const sent: string[] = [];
    sendOpenChatFirst(state, SERVER, "#closed", () => sent.push("#closed"));
    sendOpenChatFirst(state, SERVER, "#Open", () => sent.push("#open"));
    expect(sent).toEqual(["#open"]);
    vi.advanceTimersByTime(0);
    expect(sent).toEqual(["#open", "#closed"]);
  });
});
