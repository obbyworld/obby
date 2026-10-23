import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrivateChatRow } from "../../../src/components/layout/PrivateChatRow";
import type { PrivateChat } from "../../../src/types";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

const privateChat: PrivateChat = {
  id: "pc1",
  username: "alice",
  serverId: "server1",
  unreadCount: 0,
  isPinned: true,
  isMentioned: false,
  lastActivity: new Date(),
};

const renderRow = (props: Partial<Parameters<typeof PrivateChatRow>[0]>) => {
  const onOpenMenu = vi.fn();
  const onSelect = vi.fn();
  render(
    <PrivateChatRow
      privateChat={privateChat}
      server={undefined}
      mediaSettings={{
        showSafeMedia: true,
        showTrustedSourcesMedia: true,
        showExternalContent: false,
      }}
      isSelected={false}
      isPrevious={false}
      isTouch={false}
      hoverClass=""
      onSelect={onSelect}
      onOpenMenu={onOpenMenu}
      {...props}
    />,
  );
  return { onOpenMenu, onSelect };
};

describe("PrivateChatRow", () => {
  it("opens the context menu on right click like a channel row", () => {
    const { onOpenMenu } = renderRow({});
    fireEvent.contextMenu(screen.getByText("alice"));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it("shows the drag handle slot in place of the options button while reordering", () => {
    renderRow({
      isSelected: true,
      leading: <button type="button">grip</button>,
    });
    expect(screen.getByText("grip")).toBeTruthy();
    expect(screen.queryByLabelText("Open chat options")).toBeNull();
  });

  it("opens the menu from the options button when selected", () => {
    const { onOpenMenu, onSelect } = renderRow({ isSelected: true });
    fireEvent.click(screen.getByLabelText("Open chat options"));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
