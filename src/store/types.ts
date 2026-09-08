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
