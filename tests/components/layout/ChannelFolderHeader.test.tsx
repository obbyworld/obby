import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelFolderHeader } from "../../../src/components/layout/ChannelFolderHeader";
import type { ChannelFolder } from "../../../src/store/types";

const folder: ChannelFolder = {
  id: "f1",
  name: "General",
  channels: ["#general", "#random"],
  collapsed: false,
};

describe("ChannelFolderHeader", () => {
  it("calls onToggle when the name is clicked", () => {
    const onToggle = vi.fn();
    render(
      <ChannelFolderHeader
        folder={folder}
        summary={{ channelCount: 2, mentionCount: 0, hasUnread: false }}
        isRenaming={false}
        onToggle={onToggle}
        onOpenMenu={vi.fn()}
        onRename={vi.fn()}
        onRenameEnd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows the channel count when collapsed", () => {
    render(
      <ChannelFolderHeader
        folder={{ ...folder, collapsed: true }}
        summary={{ channelCount: 2, mentionCount: 0, hasUnread: false }}
        isRenaming={false}
        onToggle={vi.fn()}
        onOpenMenu={vi.fn()}
        onRename={vi.fn()}
        onRenameEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows the folder's mentions only while it is folded", () => {
    const props = {
      summary: { channelCount: 3, mentionCount: 5, hasUnread: true },
      isRenaming: false,
      onToggle: vi.fn(),
      onOpenMenu: vi.fn(),
      onRename: vi.fn(),
      onRenameEnd: vi.fn(),
    };
    const { rerender } = render(
      <ChannelFolderHeader
        folder={{ ...folder, collapsed: true }}
        {...props}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    rerender(<ChannelFolderHeader folder={folder} {...props} />);
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("shows an input while renaming and commits the trimmed value on Enter", () => {
    const onRename = vi.fn();
    const onRenameEnd = vi.fn();
    render(
      <ChannelFolderHeader
        folder={folder}
        summary={{ channelCount: 2, mentionCount: 0, hasUnread: false }}
        isRenaming={true}
        onToggle={vi.fn()}
        onOpenMenu={vi.fn()}
        onRename={onRename}
        onRenameEnd={onRenameEnd}
      />,
    );
    const input = screen.getByLabelText("Folder name");
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Renamed");
    expect(onRenameEnd).toHaveBeenCalled();
  });

  it("only calls onRenameEnd on Escape, without renaming", () => {
    const onRename = vi.fn();
    const onRenameEnd = vi.fn();
    render(
      <ChannelFolderHeader
        folder={folder}
        summary={{ channelCount: 2, mentionCount: 0, hasUnread: false }}
        isRenaming={true}
        onToggle={vi.fn()}
        onOpenMenu={vi.fn()}
        onRename={onRename}
        onRenameEnd={onRenameEnd}
      />,
    );
    const input = screen.getByLabelText("Folder name");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(onRenameEnd).toHaveBeenCalled();
  });
});
