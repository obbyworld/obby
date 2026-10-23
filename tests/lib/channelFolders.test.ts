import { describe, expect, it } from "vitest";
import {
  arrangeChannels,
  flattenChannelGroups,
  folderEntryId,
  getChannelKind,
  moveDropIntoFolder,
  readDroppedLayout,
  summarizeFolders,
} from "../../src/lib/channelFolders";
import type { ChannelFolder } from "../../src/store/types";

const ch = (name: string) => ({ id: `id-${name}`, name });
const folder = (
  id: string,
  channels: string[],
  collapsed = false,
): ChannelFolder => ({ id, name: id, channels, collapsed });

const names = (list: { name: string }[]) => list.map((c) => c.name);

describe("getChannelKind", () => {
  it("reads the prefix", () => {
    expect(getChannelKind("#dev")).toBe("text");
    expect(getChannelKind("&local")).toBe("text");
    expect(getChannelKind("^talk")).toBe("voice");
    expect(getChannelKind("$show")).toBe("stream");
  });
});

describe("arrangeChannels", () => {
  const channels = [ch("#a"), ch("^call"), ch("#b"), ch("$tv"), ch("#c")];

  it("puts loose channels first and live channels last in every group", () => {
    const groups = arrangeChannels(
      channels,
      ["#c", "^call", "#a", "$tv", "#b"],
      [folder("f", ["#B", "$tv"])],
    );
    expect(groups.map((g) => g.folder?.id ?? null)).toEqual([null, "f"]);
    expect(names(groups[0].channels)).toEqual(["#c", "#a", "^call"]);
    expect(names(groups[1].channels)).toEqual(["#b", "$tv"]);
  });

  it("keeps empty folders so they can receive drops", () => {
    const groups = arrangeChannels(channels, [], [folder("empty", [])]);
    expect(groups[1].channels).toEqual([]);
  });

  it("falls back to join order without a saved order", () => {
    const groups = arrangeChannels(channels, undefined, []);
    expect(names(groups[0].channels)).toEqual([
      "#a",
      "#b",
      "#c",
      "^call",
      "$tv",
    ]);
  });
});

describe("readDroppedLayout", () => {
  it("assigns each channel to the folder header above it", () => {
    const folders = [folder("f", ["#a"]), folder("g", [])];
    const entries = flattenChannelGroups(
      arrangeChannels([ch("#a"), ch("#b"), ch("#c")], [], folders),
    );
    // entries: #b #c [f] #a [g]; drag #b below the g header
    const ids = entries.map((e) => e.id);
    expect(ids).toEqual([
      "id-#b",
      "id-#c",
      folderEntryId("f"),
      "id-#a",
      folderEntryId("g"),
    ]);
    const dropped = [
      entries[1],
      entries[2],
      entries[3],
      entries[4],
      entries[0],
    ];
    const layout = readDroppedLayout(dropped, folders);
    expect(layout.order).toEqual(["#c", "#a", "#b"]);
    expect(layout.folders.map((f) => f.channels)).toEqual([["#a"], ["#b"]]);
  });

  it("keeps folder members we are not joined to", () => {
    const folders = [folder("f", ["#gone", "#a"])];
    const entries = flattenChannelGroups(
      arrangeChannels([ch("#a")], [], folders),
    );
    const layout = readDroppedLayout(entries, folders);
    expect(layout.folders[0].channels).toEqual(["#gone", "#a"]);
  });
});

describe("moveDropIntoFolder", () => {
  const f = folderEntryId("f");

  it("puts a channel dragged up onto a header first in that folder", () => {
    expect(moveDropIntoFolder(["a", f, "b", "c"], "c", f)).toEqual([
      "a",
      f,
      "c",
      "b",
    ]);
  });

  it("puts a channel dragged down onto a header first in that folder", () => {
    expect(moveDropIntoFolder(["a", "c", f, "b"], "a", f)).toEqual([
      "c",
      f,
      "a",
      "b",
    ]);
  });

  it("leaves drops onto channels as they are", () => {
    const ids = ["a", "b", f];
    expect(moveDropIntoFolder(ids, "a", "b")).toBe(ids);
  });
});

describe("summarizeFolders", () => {
  it("adds up channels, mentions and unread per folder", () => {
    const row = (name: string, unreadCount = 0, mentionCount = 0) => ({
      ...ch(name),
      unreadCount,
      isMentioned: mentionCount > 0,
      mentionCount,
    });
    const folders = [folder("f", ["#a", "#b"]), folder("g", ["#c"])];
    const summaries = summarizeFolders(
      flattenChannelGroups(
        arrangeChannels(
          [row("#loose", 5, 1), row("#a", 3, 2), row("#b", 1), row("#c")],
          [],
          folders,
        ),
      ),
    );
    expect(summaries.get("f")).toEqual({
      channelCount: 2,
      mentionCount: 2,
      hasUnread: true,
    });
    expect(summaries.get("g")).toEqual({
      channelCount: 1,
      mentionCount: 0,
      hasUnread: false,
    });
  });
});
