import type { SettingSearchResult } from "../../../lib/settings/types";
import type { Channel, PrivateChat, Server, User } from "../../../types";

export type UIToggleAction =
  | "toggle-member-list"
  | "toggle-channel-list"
  | "toggle-notifications"
  | "pin-private-chat"
  | "unpin-private-chat";

export type UIModalAction =
  | "open-channel-settings"
  | "open-invite-user"
  | "open-topic-modal"
  | "open-user-profile"
  | "open-rename-channel"
  | "open-server-channels"
  | "open-raw-log";

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
  | "ui-modal";

export interface JoinChannelData {
  channelName: string;
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
    | UIActionData;
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
