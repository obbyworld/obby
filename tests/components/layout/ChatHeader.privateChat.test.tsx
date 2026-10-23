import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "../../../src/components/layout/ChatHeader";
import useStore from "../../../src/store";
import type { PrivateChat, User } from "../../../src/types";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

const me: User = { id: "u1", username: "me", isOnline: true };
const pm: PrivateChat = {
  id: "pc1",
  username: "alice",
  serverId: "server1",
  unreadCount: 0,
  isPinned: false,
  isMentioned: false,
  lastActivity: new Date(),
};

const renderHeader = () =>
  render(
    <ChatHeader
      selectedChannel={null}
      selectedPrivateChat={pm}
      selectedServerId="server1"
      selectedChannelId={null}
      currentUser={me}
      isChanListVisible={false}
      isMemberListVisible={false}
      isNarrowView={true}
      globalSettings={{ notificationVolume: 0.5 }}
      searchQuery=""
      onToggleChanList={() => {}}
      onToggleMemberList={() => {}}
      onSearchQueryChange={() => {}}
      onToggleNotificationVolume={() => {}}
      onOpenChannelSettings={() => {}}
      onOpenInviteUser={() => {}}
      onOpenBots={() => {}}
    />,
  );

describe("ChatHeader private chat", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [
        {
          id: "server1",
          name: "Test",
          host: "irc.test.com",
          port: 6667,
          channels: [],
          privateChats: [pm],
          isConnected: true,
          users: [me],
          connectionState: "connected",
        },
      ],
    });
  });

  it("keeps pin and profile out of the action row", () => {
    renderHeader();
    expect(screen.queryByTitle("Pin")).toBeNull();
    expect(screen.queryByTitle("Unpin")).toBeNull();
    expect(screen.queryByTitle("User Profile")).toBeNull();
  });

  it("lists pin and profile in the overflow menu", () => {
    renderHeader();
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(screen.getByText("Pin conversation")).toBeTruthy();
    expect(screen.getByText("See profile")).toBeTruthy();
  });

  it("pins the conversation from the overflow menu", () => {
    const pinPrivateChat = vi.fn();
    useStore.setState({ pinPrivateChat });
    renderHeader();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Pin conversation"));
    expect(pinPrivateChat).toHaveBeenCalledWith("server1", "pc1");
  });

  it("opens the profile when the name is tapped", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /^alice/ }));
    expect(useStore.getState().ui.profileViewRequest?.username).toBe("alice");
  });
});
