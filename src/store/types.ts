import type { SavedDevice } from "../lib/mediaDevices";
import type { MediaVisibilityLevel } from "../lib/mediaUtils";
import type { SearchQuery, SearchScope } from "../lib/search/searchTypes";
import type { Message } from "../types";

export type layoutColumn = "serverList" | "chatView" | "memberList";

// A chat that shows an older stretch of its history. It shows nothing newer
// than `until`, and we keep its newest messages in `present` to show again
// when the user jumps back. `jumpId` changes each time a jump replaces it.
export interface HistoryWindow {
  until: number;
  untilRowId?: number;
  present: Message[];
  jumpId?: number;
}
export type { MediaVisibilityLevel };

export interface ConnectionDetails {
  name: string;
  host: string;
  port: string;
  nickname: string;
  useWebSocket?: boolean;
  ui?: {
    disableServerConnectionInfo?: boolean;
    hideServerInfo?: boolean;
    hideClose?: boolean;
    title?: string;
    lockWebSocket?: boolean;
  };
}

export type SavedMetadata = Record<
  string,
  Record<string, Record<string, { value: string; visibility: string }>>
>;

export type PinnedPrivateChatsMap = Record<
  string,
  Array<{ username: string; order: number }>
>;

export type ChannelOrderMap = Record<string, string[]>;

export interface ChannelFolder {
  id: string;
  name: string;
  channels: string[];
  collapsed: boolean;
}

export type ChannelFoldersMap = Record<string, ChannelFolder[]>;

export interface GlobalSettings {
  enableNotifications: boolean;
  notificationsOffered: boolean;
  notificationSound: string;
  enableNotificationSounds: boolean;
  notificationVolume: number;
  enableHighlights: boolean;
  sendTypingNotifications: boolean;
  showEvents: boolean;
  showNickChanges: boolean;
  showJoinsParts: boolean;
  showQuits: boolean;
  showKicks: boolean;
  customMentions: string[];
  ignoreList: string[];
  keepHistory: boolean;
  closeToTray: boolean;
  historyLimitMb: number;
  nickname: string;
  accountName: string;
  accountPassword: string;
  enableMultilineInput: boolean;
  multilineOnShiftEnter: boolean;
  autoFallbackToSingleLine: boolean;
  mediaVisibilityLevel: MediaVisibilityLevel;
  enableMarkdownRendering: boolean;
  showMotd: boolean;
  awayMessage: string;
  quitMessage: string;
  callAudioInput: SavedDevice | null;
  callVideoInput: SavedDevice | null;
  callAudioOutput: SavedDevice | null;
  callCameraFacing: "user" | "environment";
  callEchoCancellation: boolean;
  callNoiseSuppression: boolean;
  callAutoGainControl: boolean;
}

export interface UISelections {
  selectedServerId: string | null;
  perServerSelections: Record<
    string,
    {
      selectedChannelId: string | null;
      selectedChannelName?: string | null;
      selectedPrivateChatId: string | null;
      selectedPrivateChatUsername?: string | null;
    }
  >;
  sidebarPreferences?: {
    channelList: { isVisible: boolean; width: number };
    memberList: { isVisible: boolean; width: number };
  };
  lastSelection?: {
    serverHost: string;
    channelName: string | null;
    privateChatUsername: string | null;
  };
}

export type SettingsSection =
  | "profile"
  | "notifications"
  | "preferences"
  | "media"
  | "calls"
  | "account"
  | "invitations"
  | "privacy";

// Pages fill the chat column; `highlight` names the row Ctrl+K jumps to,
// matched against the row's `setting-<id>` element id, and `fromSearch` marks
// a Ctrl+K jump, the only kind that flashes what it lands on.
export type AppPage = (
  | { kind: "settings"; section?: SettingsSection; highlight?: string }
  | {
      kind: "serverSettings";
      serverId: string;
      section?: string;
      highlight?: string;
    }
  | {
      kind: "channelSettings";
      serverId: string;
      channelName: string;
      section?: string;
      highlight?: string;
    }
  | { kind: "channelBrowser"; serverId: string }
  | { kind: "bots"; serverId: string; botNick?: string }
  | { kind: "rawLog"; serverId: string }
  | { kind: "twoFactor"; serverId: string }
  | { kind: "emojiPacks"; serverId: string }
) & { fromSearch?: boolean };

export interface ProfilePane {
  serverId: string;
  username: string;
}

// isChatShown hides the results behind the chat where both cannot fit;
// hitChatId is the chat a result opened, so the way back shows only there,
// and hitMessageId is the message it landed on, which the chat keeps marked.
// session changes when a search starts outside the pane, and stays while the
// pane searches as the reader types.
export type SidePane =
  | ({ kind: "profile" } & ProfilePane)
  | {
      kind: "search";
      query: SearchQuery;
      session: number;
      isChatShown?: boolean;
      hitChatId?: string;
      hitMessageId?: string;
    };

export type QuickActionsMode = "goto" | "messages";

export interface QuickActionsState {
  mode: QuickActionsMode;
  scope?: SearchScope;
}
