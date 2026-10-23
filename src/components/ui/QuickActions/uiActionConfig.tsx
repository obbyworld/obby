import { UsersIcon } from "@heroicons/react/24/solid";
import { t } from "@lingui/core/macro";
import type React from "react";
import {
  FaBell,
  FaEdit,
  FaHashtag,
  FaInfoCircle,
  FaThumbtack,
  FaUserPlus,
} from "react-icons/fa";
import type {
  QuickActionContext,
  QuickActionResultType,
  UIActionData,
} from "./types";

export interface UIActionConfig {
  id: string;
  type: QuickActionResultType;
  title: string;
  description?: string;
  keywords: string[];
  score: number;
  icon: React.ReactNode;
  badge: string;
  data: UIActionData;
  availability: (context: QuickActionContext) => boolean;
}

export function getUIActions(): UIActionConfig[] {
  return [
    {
      id: "toggle-member-list",
      type: "ui-toggle",
      title: t`Toggle Member List`,
      description: t`Show or hide the member list sidebar`,
      keywords: ["member", "list", "sidebar", "users", "toggle"],
      score: 90,
      icon: <UsersIcon className="w-4 h-4" />,
      badge: t`Toggle`,
      data: { action: "toggle-member-list" },
      availability: (ctx) => ctx.selectedChannel !== null,
    },
    {
      id: "toggle-channel-list",
      type: "ui-toggle",
      title: t`Toggle Channel List`,
      description: t`Show or hide the channel list sidebar`,
      keywords: ["channel", "list", "sidebar", "toggle"],
      score: 90,
      icon: <FaHashtag className="w-4 h-4" />,
      badge: t`Toggle`,
      data: { action: "toggle-channel-list" },
      availability: () => true,
    },
    {
      id: "toggle-notifications",
      type: "ui-toggle",
      title: t`Toggle Notifications`,
      description: t`Mute or unmute notification sounds`,
      keywords: ["notification", "sound", "mute", "unmute", "bell", "toggle"],
      score: 80,
      icon: <FaBell className="w-4 h-4" />,
      badge: t`Toggle`,
      data: { action: "toggle-notifications" },
      availability: () => true,
    },
    {
      id: "pin-private-chat",
      type: "ui-toggle",
      title: t`Pin Private Chat`,
      description: t`Pin this private message conversation`,
      keywords: ["pin", "private", "message", "dm", "chat"],
      score: 75,
      icon: <FaThumbtack className="w-4 h-4" />,
      badge: t`Toggle`,
      data: { action: "pin-private-chat" },
      availability: (ctx) =>
        ctx.selectedPrivateChat !== null && !ctx.selectedPrivateChat.isPinned,
    },
    {
      id: "unpin-private-chat",
      type: "ui-toggle",
      title: t`Unpin Private Chat`,
      description: t`Unpin this private message conversation`,
      keywords: ["unpin", "private", "message", "dm", "chat"],
      score: 75,
      icon: <FaThumbtack className="w-4 h-4" />,
      badge: t`Toggle`,
      data: { action: "unpin-private-chat" },
      availability: (ctx) => ctx.selectedPrivateChat?.isPinned === true,
    },
    {
      id: "open-invite-user",
      type: "ui-modal",
      title: t`Invite User`,
      description: t`Invite a user to the current channel`,
      keywords: ["invite", "user", "add"],
      score: 75,
      icon: <FaUserPlus className="w-4 h-4" />,
      badge: t`Modal`,
      data: { action: "open-invite-user" },
      availability: (ctx) => ctx.selectedChannel !== null,
    },
    {
      id: "open-rename-channel",
      type: "ui-modal",
      title: t`Rename Channel`,
      description: t`Change the channel name (operators only)`,
      keywords: ["rename", "channel", "name"],
      score: 70,
      icon: <FaEdit className="w-4 h-4" />,
      badge: t`Modal`,
      data: { action: "open-rename-channel" },
      availability: (ctx) => ctx.selectedChannel !== null && ctx.isOperator,
    },
    {
      id: "open-topic-modal",
      type: "ui-modal",
      title: t`View Channel Topic`,
      description: t`View or edit the channel topic`,
      keywords: ["topic", "channel", "description"],
      score: 70,
      icon: <FaInfoCircle className="w-4 h-4" />,
      badge: t`Modal`,
      data: { action: "open-topic-modal" },
      availability: (ctx) =>
        ctx.selectedChannel !== null && !!ctx.selectedChannel.topic,
    },
    {
      id: "open-user-profile",
      type: "ui-modal",
      title: t`User Profile`,
      description: t`View user profile information`,
      keywords: ["user", "profile", "info", "information"],
      score: 75,
      icon: <FaInfoCircle className="w-4 h-4" />,
      badge: t`Modal`,
      data: { action: "open-user-profile" },
      availability: (ctx) => ctx.selectedPrivateChat !== null,
    },
  ];
}

export function getUIActionIcon(actionId: string): React.ReactNode {
  const action = getUIActions().find((a) => a.id === actionId);
  if (!action) return null;

  if (actionId === "toggle-notifications") {
    return action.icon;
  }

  return action.icon;
}
