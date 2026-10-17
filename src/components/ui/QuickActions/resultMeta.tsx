import { t } from "@lingui/core/macro";
import type React from "react";
import {
  FaClock,
  FaCog,
  FaHashtag,
  FaHistory,
  FaMicrophone,
  FaSearch,
  FaServer,
  FaUser,
} from "react-icons/fa";
import { classifyChannelName } from "../../../lib/channelMentions";
import { fuzzyMatch } from "../../../lib/fuzzySearch";
import type { Channel, PrivateChat } from "../../../types";
import HighlightedText from "../HighlightedText";
import type { QuickActionResult } from "./types";
import { getUIActionIcon } from "./uiActionConfig";

export function resultGroupTitle(result: QuickActionResult): string {
  switch (result.type) {
    case "setting":
      return t`Settings`;
    case "page":
      return t`Pages`;
    case "channel":
    case "join-channel":
      return t`Channels`;
    case "dm":
    case "start-dm":
      return t`People`;
    case "server":
      return t`Servers`;
    case "ui-toggle":
    case "ui-modal":
      return t`Actions`;
    case "recent-search":
      return t`Recent searches`;
    case "recent-place":
      return t`Recent places`;
    case "search-messages":
      return t`Messages`;
  }
}

export function resultIcon(result: QuickActionResult): React.ReactNode {
  switch (result.type) {
    case "setting":
    case "page":
      return <FaCog />;
    case "channel":
    case "join-channel": {
      const name =
        result.type === "channel"
          ? (result.data as Channel).name
          : (result.data as { channelName: string }).channelName;
      return classifyChannelName(name) === "voice" ? (
        <FaMicrophone />
      ) : (
        <FaHashtag />
      );
    }
    case "dm":
    case "start-dm":
      return <FaUser />;
    case "server":
      return <FaServer />;
    case "ui-toggle":
    case "ui-modal":
      return getUIActionIcon(result.id) ?? <FaCog />;
    case "recent-search":
      return <FaHistory />;
    case "recent-place":
      return <FaClock />;
    case "search-messages":
      return <FaSearch />;
  }
}

export const MatchedText: React.FC<{ text: string; query: string }> = ({
  text,
  query,
}) => (
  <HighlightedText
    text={text}
    ranges={query ? fuzzyMatch(query, text).ranges : []}
    markClassName="bg-transparent font-semibold underline decoration-2 underline-offset-[3px]"
  />
);

export const UnreadIndicator: React.FC<{ result: QuickActionResult }> = ({
  result,
}) => {
  if (result.type !== "channel" && result.type !== "dm") return null;
  const item = result.data as Channel | PrivateChat;
  if (item.isMentioned && item.unreadCount > 0) {
    return (
      <span className="shrink-0 bg-discord-red text-white text-xs font-bold rounded-full px-1.5 min-w-[20px] text-center">
        {item.unreadCount}
      </span>
    );
  }
  if (item.unreadCount > 0) {
    return <span className="shrink-0 w-2 h-2 rounded-full bg-white" />;
  }
  return null;
};
