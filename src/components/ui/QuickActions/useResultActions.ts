import { useJoinAndSelectChannel } from "../../../hooks/useJoinAndSelectChannel";
import { toggleNotificationSound } from "../../../lib/notificationVolume";
import type { RecentPlace } from "../../../lib/search/recents";
import type { SearchQuery } from "../../../lib/search/searchTypes";
import type { SettingSearchResult } from "../../../lib/settings/types";
import useStore from "../../../store";
import type { AppPage, SettingsSection } from "../../../store/types";
import type { Channel, PrivateChat } from "../../../types";
import type {
  JoinChannelData,
  QuickActionResult,
  StartDmData,
  UIActionData,
  UIModalAction,
  UIToggleAction,
} from "./types";

function runToggle(data: UIActionData) {
  const state = useStore.getState();
  switch (data.action as UIToggleAction) {
    case "toggle-member-list":
      state.toggleMemberList();
      break;
    case "toggle-channel-list":
      state.toggleChannelList();
      break;
    case "toggle-notifications":
      toggleNotificationSound();
      break;
    case "pin-private-chat":
      if (data.serverId && data.privateChatId)
        state.pinPrivateChat(data.serverId, data.privateChatId);
      break;
    case "unpin-private-chat":
      if (data.serverId && data.privateChatId)
        state.unpinPrivateChat(data.serverId, data.privateChatId);
      break;
  }
}

function runModal(data: UIActionData) {
  const state = useStore.getState();
  switch (data.action as UIModalAction) {
    case "open-invite-user":
      if (data.serverId && data.channelId)
        state.setInviteUserRequest(data.serverId, data.channelId);
      break;
    case "open-rename-channel": {
      const channelName = state.servers
        .find((s) => s.id === data.serverId)
        ?.channels.find((c) => c.id === data.channelId)?.name;
      if (data.serverId && channelName)
        state.openPage({
          kind: "channelSettings",
          serverId: data.serverId,
          channelName,
          section: "general",
          fromSearch: true,
        });
      break;
    }
    case "open-topic-modal":
      if (data.serverId && data.channelId)
        state.setTopicModalRequest(data.serverId, data.channelId);
      break;
    case "open-user-profile":
      if (data.serverId && data.username)
        state.openProfile(data.serverId, data.username);
      break;
  }
}

// Runs a palette result; message searches go through the search draft instead.
export function useResultActions() {
  const joinAndSelectChannel = useJoinAndSelectChannel();

  return (result: QuickActionResult) => {
    const state = useStore.getState();
    switch (result.type) {
      case "recent-search":
        state.openSearchResults(result.data as SearchQuery);
        break;
      case "recent-place": {
        const place = result.data as RecentPlace;
        state.openChat(place.serverId, place.name);
        break;
      }
      case "setting": {
        const { setting } = result.data as SettingSearchResult;
        state.openPage({
          kind: "settings",
          section: setting.category as SettingsSection,
          highlight: setting.id,
          fromSearch: true,
        });
        break;
      }
      case "page":
        state.openPage({ ...(result.data as AppPage), fromSearch: true });
        break;
      case "channel":
        state.selectServer(result.serverId || null);
        state.selectChannel((result.data as Channel).id, { navigate: true });
        break;
      case "dm":
        state.selectServer(result.serverId || null);
        state.selectPrivateChat((result.data as PrivateChat).id, {
          navigate: true,
        });
        break;
      case "server":
        state.selectServer(result.id.replace("server-", ""));
        break;
      case "join-channel":
        if (result.serverId && result.data) {
          state.selectServer(result.serverId);
          joinAndSelectChannel(
            result.serverId,
            (result.data as JoinChannelData).channelName,
          );
        }
        break;
      case "start-dm":
        if (result.serverId)
          state.openChat(
            result.serverId,
            (result.data as StartDmData).username,
          );
        break;
      case "ui-toggle":
        runToggle(result.data as UIActionData);
        break;
      case "ui-modal":
        runModal(result.data as UIActionData);
        break;
    }
  };
}
