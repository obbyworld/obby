import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelContextMenu } from "../../../src/components/layout/ChannelContextMenu";
import { useChannelFolders } from "../../../src/store/channelFolders";
import type { Channel, User } from "../../../src/types";

const markChannelAsRead = vi.fn();
const leaveChannel = vi.fn();
let notificationVolume = 0.4;

vi.mock("../../../src/store", () => {
  const mockStore = vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      markChannelAsRead,
      leaveChannel,
      globalSettings: { notificationVolume },
    }),
  );
  return { default: mockStore };
});

const toggleNotificationSound = vi.fn();
vi.mock("../../../src/lib/notificationVolume", () => ({
  toggleNotificationSound: () => toggleNotificationSound(),
}));

let currentUser: User | null = null;
vi.mock("../../../src/lib/ircClient", () => ({
  default: { getCurrentUser: () => currentUser },
}));

const makeChannel = (overrides: Partial<Channel> = {}): Channel => ({
  id: "channel1",
  name: "#general",
  isPrivate: false,
  serverId: "server1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: [],
  ...overrides,
});

describe("ChannelContextMenu", () => {
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "u1", username: "me", isOnline: true };
    notificationVolume = 0.4;
    useChannelFolders.setState({ folders: {} });
    anchor = document.createElement("button");
    document.body.appendChild(anchor);
  });

  it("opens a folder flyout when 'Move to folder' is clicked", () => {
    render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to folder/i }));
    expect(
      screen.getByRole("menuitem", { name: /create folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /move to folder/i }),
    ).toBeInTheDocument();
  });

  it("moves the channel into an existing folder", () => {
    useChannelFolders.setState({
      folders: {
        server1: [{ id: "f1", name: "Work", channels: [], collapsed: false }],
      },
    });
    render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to folder/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Work" }));
    expect(useChannelFolders.getState().folders.server1?.[0].channels).toEqual([
      "#general",
    ]);
  });

  it("shows 'Take out of folder' only when the channel is already in a folder", () => {
    useChannelFolders.setState({
      folders: {
        server1: [
          { id: "f1", name: "Work", channels: ["#general"], collapsed: false },
        ],
      },
    });
    render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to folder/i }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /take out of folder/i }),
    );
    expect(useChannelFolders.getState().folders.server1?.[0].channels).toEqual(
      [],
    );
  });

  it("creates a new folder holding the channel and calls onNewFolder", () => {
    const onNewFolder = vi.fn();
    render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={onNewFolder}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /move to folder/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /create folder/i }));

    expect(onNewFolder).toHaveBeenCalledTimes(1);
    const newId = onNewFolder.mock.calls[0][0];
    const created = useChannelFolders
      .getState()
      .folders.server1?.find((f) => f.id === newId);
    expect(created?.channels).toEqual(["#general"]);
  });

  it("calls onInvite when 'Invite user' is clicked", () => {
    const onInvite = vi.fn();
    render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={onInvite}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /invite user/i }));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("labels the sound toggle by the current notification volume", () => {
    notificationVolume = 0.4;
    const { rerender } = render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /mute notifications/i }),
    );
    expect(toggleNotificationSound).toHaveBeenCalledTimes(1);

    notificationVolume = 0;
    rerender(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel()}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("menuitem", { name: /enable notifications/i }),
    ).toBeInTheDocument();
  });

  it("only shows 'Mark as read' when the channel has unread messages", () => {
    const { rerender } = render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel({ unreadCount: 0, isMentioned: false })}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("menuitem", { name: /mark as read/i }),
    ).not.toBeInTheDocument();

    rerender(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel({ unreadCount: 3, isMentioned: false })}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /mark as read/i }));
    expect(markChannelAsRead).toHaveBeenCalledWith("server1", "channel1");
  });

  it("labels the settings item for an op vs a regular member", () => {
    const { rerender } = render(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel({
          users: [{ id: "u1", username: "me", isOnline: true, status: "@" }],
        })}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("menuitem", { name: /edit channel settings/i }),
    ).toBeInTheDocument();

    rerender(
      <ChannelContextMenu
        serverId="server1"
        channel={makeChannel({
          users: [{ id: "u1", username: "me", isOnline: true }],
        })}
        anchor={anchor}
        onClose={vi.fn()}
        onInvite={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("menuitem", { name: /see channel info/i }),
    ).toBeInTheDocument();
  });
});
