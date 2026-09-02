import { describe, expect, it } from "vitest";
import { shouldShowMessageHeader } from "../../src/lib/messageGrouping";
import type { Message } from "../../src/types";

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: "m",
    type: "message",
    content: "hi",
    timestamp: new Date("2026-01-01T12:00:00.000Z"),
    userId: "alice",
    channelId: "c",
    serverId: "s",
    reactions: [],
    replyMessage: null,
    mentioned: [],
    ...overrides,
  };
}

const unprotected = (extra: Partial<Message> = {}) =>
  msg({ tags: { "e2ee-unprotected": "1" }, ...extra });

describe("shouldShowMessageHeader", () => {
  it("shows a header for the first message", () => {
    expect(shouldShowMessageHeader(undefined, msg())).toBe(true);
  });

  it("groups consecutive same-author messages within the window", () => {
    const prev = msg({ timestamp: new Date("2026-01-01T12:00:00.000Z") });
    const next = msg({ timestamp: new Date("2026-01-01T12:00:30.000Z") });
    expect(shouldShowMessageHeader(prev, next)).toBe(false);
  });

  it("breaks the group when the author changes", () => {
    expect(shouldShowMessageHeader(msg({ userId: "bob" }), msg())).toBe(true);
  });

  it("breaks the group after the group window elapses", () => {
    const prev = msg({ timestamp: new Date("2026-01-01T12:00:00.000Z") });
    const next = msg({ timestamp: new Date("2026-01-01T12:06:00.000Z") });
    expect(shouldShowMessageHeader(prev, next)).toBe(true);
  });

  it("breaks the group when a non-message precedes", () => {
    expect(shouldShowMessageHeader(msg({ type: "system" }), msg())).toBe(true);
  });

  it("breaks the group when encryption protection changes either way", () => {
    expect(shouldShowMessageHeader(msg(), unprotected())).toBe(true);
    expect(shouldShowMessageHeader(unprotected(), msg())).toBe(true);
  });

  it("keeps a run of unprotected messages in one group", () => {
    const a = unprotected({ timestamp: new Date("2026-01-01T12:00:00.000Z") });
    const b = unprotected({ timestamp: new Date("2026-01-01T12:00:10.000Z") });
    expect(shouldShowMessageHeader(a, b)).toBe(false);
  });
});
