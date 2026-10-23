import type { SavedDevice } from "../lib/mediaDevices";
import type { MediaVisibilityLevel } from "../lib/mediaUtils";

export type layoutColumn = "serverList" | "chatView" | "memberList";
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
