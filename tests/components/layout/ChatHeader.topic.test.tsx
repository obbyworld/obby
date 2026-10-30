import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatHeader } from "../../../src/components/layout/ChatHeader";
import type { Channel, User } from "../../../src/types";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockResolvedValue("linux"),
}));

const user: User = { id: "user1", username: "testuser", isOnline: true };

const channel: Channel = {
  id: "channel1",
  name: "#general",
  topic: "\x0304Red\x03 and \x02bold\x02",
  isPrivate: false,
  serverId: "server1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: [user],
  metadata: {},
};

describe("ChatHeader topic", () => {
  it("shows the topic without raw IRC formatting codes", () => {
    render(
      <ChatHeader
        selectedChannel={channel}
        selectedPrivateChat={null}
        selectedServerId="server1"
        selectedChannelId="channel1"
        currentUser={user}
        isChanListVisible={true}
        isMemberListVisible={false}
        isNarrowView={false}
        globalSettings={{ notificationVolume: 0.5 }}
        onToggleChanList={() => {}}
        onToggleMemberList={() => {}}
        onToggleNotificationVolume={() => {}}
        onOpenChannelSettings={() => {}}
        onOpenInviteUser={() => {}}
        onOpenBots={() => {}}
      />,
    );

    const topic = screen.getByTitle("Red and bold");
    expect(topic.textContent).toBe("Red and bold");
  });
});
