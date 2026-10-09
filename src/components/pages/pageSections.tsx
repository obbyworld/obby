import { t } from "@lingui/core/macro";
import {
  FaBan,
  FaBell,
  FaCog,
  FaImage,
  FaKey,
  FaMicrophone,
  FaServer,
  FaShareSquare,
  FaShieldAlt,
  FaSlidersH,
  FaUser,
  FaUserPlus,
  FaUserShield,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import { hasOpPermission } from "../../lib/ircUtils";
import { serverSupportsMetadata } from "../../store";
import type { SettingsSection } from "../../store/types";
import type { Channel, Server } from "../../types";
import type { PageSection } from "../ui/page/PageShell";

// The section lists of every sectioned page, read by the pages and by Ctrl+K
// so both always offer the same sections under the same names.
export interface PageSectionEntry extends PageSection {
  keywords?: string[];
}

const iconClass = "w-4 h-4";

export function getSettingsSections(): Array<
  PageSectionEntry & { id: SettingsSection }
> {
  return [
    {
      id: "profile",
      label: t`Profile`,
      icon: <FaUser className={iconClass} />,
      description: t`Manage your profile information and metadata`,
    },
    {
      id: "notifications",
      label: t`Notifications`,
      icon: <FaBell className={iconClass} />,
      description: t`Configure notification sounds and highlights`,
    },
    {
      id: "preferences",
      label: t`Preferences`,
      icon: <FaCog className={iconClass} />,
      description: t`Customize your IRC client experience`,
    },
    {
      id: "media",
      label: t`Media`,
      icon: <FaImage className={iconClass} />,
      description: t`Control media display and external content`,
    },
    {
      id: "calls",
      label: t`Calls`,
      icon: <FaMicrophone className={iconClass} />,
      description: t`Choose the microphone, camera, and speaker calls use`,
    },
    {
      id: "account",
      label: t`Account`,
      icon: <FaServer className={iconClass} />,
      description: t`Manage your account and authentication`,
    },
    {
      id: "invitations",
      label: t`Invitations`,
      icon: <FaShareSquare className={iconClass} />,
      description: t`Create and manage your invite links`,
    },
    {
      id: "privacy",
      label: t`Privacy`,
      icon: <FaShieldAlt className={iconClass} />,
      description: t`View our privacy policy and data practices`,
    },
  ];
}

export function getServerSettingsSections(): PageSectionEntry[] {
  return [
    {
      id: "general",
      label: t`General`,
      icon: <FaServer className={iconClass} />,
      keywords: ["host", "port", "nickname"],
    },
    {
      id: "auth",
      label: t`Authentication`,
      icon: <FaKey className={iconClass} />,
      keywords: ["sasl", "password", "login", "account"],
    },
    {
      id: "oauth",
      label: t`OAuth2`,
      icon: <FaShieldAlt className={iconClass} />,
      keywords: ["oauth", "token", "sso"],
    },
    {
      id: "operator",
      label: t`IRC Operator`,
      icon: <FaUserShield className={iconClass} />,
      keywords: ["oper", "ircop", "admin"],
    },
  ];
}

export function getChannelSettingsAccess(server: Server, channel: Channel) {
  const nick = ircClient.getCurrentUser(server.id)?.username;
  const isOp = hasOpPermission(
    channel.users.find((u) => u.username === nick)?.status,
  );
  return {
    canEditMetadata: isOp && serverSupportsMetadata(server.id),
    canEditAdvanced:
      isOp && !!(server.namedModes?.supported || server.isUnrealIRCd),
  };
}

export function getChannelSettingsSections(access: {
  canEditMetadata: boolean;
  canEditAdvanced: boolean;
}): PageSectionEntry[] {
  return [
    ...(access.canEditMetadata
      ? [
          {
            id: "general",
            label: t`General`,
            icon: <FaSlidersH className={iconClass} />,
            keywords: ["rename", "topic", "avatar"],
          },
        ]
      : []),
    {
      id: "bans",
      label: t`Bans`,
      icon: <FaBan className={iconClass} />,
      keywords: ["ban", "kick", "block"],
    },
    {
      id: "exceptions",
      label: t`Exceptions`,
      icon: <FaShieldAlt className={iconClass} />,
      keywords: ["ban exception", "except", "allow"],
    },
    {
      id: "invites",
      label: t`Invitations`,
      icon: <FaUserPlus className={iconClass} />,
      keywords: ["invite exception", "invex"],
    },
    ...(access.canEditMetadata
      ? [
          {
            id: "settings",
            label: t`Settings`,
            icon: <FaCog className={iconClass} />,
            keywords: ["modes", "flood", "key", "limit"],
          },
        ]
      : []),
    ...(access.canEditAdvanced
      ? [
          {
            id: "advanced",
            label: t`Advanced`,
            icon: <FaCog className={iconClass} />,
            keywords: ["named modes", "properties"],
          },
        ]
      : []),
  ];
}
