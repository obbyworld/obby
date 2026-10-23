import type { RecentPlace } from "../../../lib/search/recents";
import type { SearchQuery } from "../../../lib/search/searchTypes";
import type { SettingSearchResult } from "../../../lib/settings/types";
import type { AppPage } from "../../../store/types";
import type { Channel, PrivateChat, Server, User } from "../../../types";

export type UIToggleAction =
  | "toggle-member-list"
  | "toggle-channel-list"
  | "toggle-notifications"
  | "pin-private-chat"
  | "unpin-private-chat";

export type UIModalAction =
  | "open-invite-user"
  | "open-topic-modal"
  | "open-user-profile"
  | "open-rename-channel";

export interface UIActionData {
  action: UIToggleAction | UIModalAction;
  serverId?: string;
  channelId?: string;
  privateChatId?: string;
  username?: string;
}

export type QuickActionResultType =
  | "setting"
  | "channel"
  | "dm"
  | "server"
  | "join-channel"
  | "start-dm"
  | "ui-toggle"
  | "ui-modal"
  | "page"
  | "recent-search"
  | "recent-place"
  | "search-messages";

export interface JoinChannelData {
  channelName: string;
}

export interface StartDmData {
  username: string;
}

export interface QuickActionResult {
  type: QuickActionResultType;
  id: string;
  title: string;
  description?: string;
  serverId?: string;
  score: number;
  data?:
    | SettingSearchResult
    | Channel
    | PrivateChat
    | Server
    | JoinChannelData
    | StartDmData
    | UIActionData
    | AppPage
    | SearchQuery
    | RecentPlace;
}

export interface QuickActionContext {
  selectedChannel: Channel | null;
  selectedPrivateChat: PrivateChat | null;
  selectedServerId: string | null;
  currentUser: User | null;
  isOperator: boolean;
  isMemberListVisible: boolean;
  isChannelListVisible: boolean;
  notificationVolume: number;
}
