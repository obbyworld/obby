import { beforeEach, describe, expect, it } from "vitest";
import { useChannelFolders } from "../../src/store/channelFolders";

const S = "server-1";
const folders = () => useChannelFolders.getState().folders[S] ?? [];
const actions = () => useChannelFolders.getState();

describe("channel folders store", () => {
  beforeEach(() => {
    useChannelFolders.setState({ folders: {} });
  });

  it("creates a folder holding the channel it was made from", () => {
    actions().createFolder(S, "one", "#a");
    actions().createFolder(S, "two", "#a");
    expect(folders().map((f) => [f.name, f.channels])).toEqual([
      ["one", []],
      ["two", ["#a"]],
    ]);
  });

  it("moves a channel between folders and out of them", () => {
    actions().createFolder(S, "one");
    actions().createFolder(S, "two");
    const [one, two] = folders();
    actions().moveChannelToFolder(S, "#a", one.id);
    actions().moveChannelToFolder(S, "#A", two.id);
    expect(folders().map((f) => f.channels)).toEqual([[], ["#A"]]);
    actions().moveChannelToFolder(S, "#a", null);
    expect(folders().map((f) => f.channels)).toEqual([[], []]);
  });

  it("renames, folds, reorders and deletes", () => {
    actions().createFolder(S, "one");
    actions().createFolder(S, "two");
    const [one, two] = folders();
    actions().renameFolder(S, one.id, "first");
    actions().toggleFolderCollapsed(S, one.id);
    actions().moveFolder(S, two.id, -1);
    actions().moveFolder(S, two.id, -1);
    expect(folders().map((f) => [f.name, f.collapsed])).toEqual([
      ["two", false],
      ["first", true],
    ]);
    actions().deleteFolder(S, one.id);
    expect(folders().map((f) => f.name)).toEqual(["two"]);
  });

  it("persists to localStorage", () => {
    actions().createFolder(S, "saved");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "channelFolders",
      expect.stringContaining("saved"),
    );
  });
});
