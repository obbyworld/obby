import { describe, expect, it } from "vitest";
import { unreadLevel, unreadTotals, withDot } from "../../src/lib/desktopTray";
import type { Server } from "../../src/types";

describe("tray unread state", () => {
  it("prefers mentions over plain unread messages", () => {
    expect(unreadLevel(0, 0)).toBe("none");
    expect(unreadLevel(4, 0)).toBe("unread");
    expect(unreadLevel(4, 1)).toBe("mention");
  });

  it("adds up channels and private chats on every server", () => {
    const servers = [
      {
        channels: [{ unreadCount: 3, mentionCount: 1 }, { unreadCount: 2 }],
        privateChats: [{ unreadCount: 1, mentionCount: 1 }],
      },
      { channels: [{ unreadCount: 5, mentionCount: 0 }] },
    ] as unknown as Server[];
    expect(unreadTotals(servers)).toEqual({ unread: 11, mentions: 2 });
  });

  it("paints a dot in the top right corner and leaves the rest alone", () => {
    const size = 32;
    const rgba = new Uint8Array(size * size * 4);
    const dotted = withDot(rgba, size, size, [242, 63, 67]);
    const pixel = (x: number, y: number) =>
      Array.from(dotted.slice((y * size + x) * 4, (y * size + x) * 4 + 4));

    expect(pixel(size - 8, 8)).toEqual([242, 63, 67, 255]);
    expect(pixel(2, size - 2)).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});
