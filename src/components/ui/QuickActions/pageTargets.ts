import { t } from "@lingui/core/macro";
import useStore from "../../../store";
import type { AppPage } from "../../../store/types";
import {
  getChannelSettingsAccess,
  getChannelSettingsSections,
  getServerSettingsSections,
  getSettingsSections,
} from "../../pages/pageSections";
import type { QuickActionContext } from "./types";

export interface PageTarget {
  id: string;
  title: string;
  /** Where the target lives, shown under its title. */
  path: string;
  keywords: string[];
  page: AppPage;
}

export function settingsSectionTitle(section: string): string {
  return getSettingsSections().find((s) => s.id === section)?.label ?? section;
}

// Every page and page section Ctrl+K can open, so a search for "bans" or
// "oauth" lands on the right section like a setting does.
export function getPageTargets(ctx: QuickActionContext): PageTarget[] {
  const settings = t`Settings`;
  const targets: PageTarget[] = [
    {
      id: "settings",
      title: settings,
      path: t`App`,
      keywords: ["preferences", "options", "config"],
      page: { kind: "settings" },
    },
    ...getSettingsSections().map((section) => ({
      id: `settings-${section.id}`,
      title: section.label,
      path: settings,
      keywords: [],
      page: { kind: "settings" as const, section: section.id },
    })),
  ];

  const serverId = ctx.selectedServerId;
  const server = useStore.getState().servers.find((s) => s.id === serverId);
  if (!serverId || !server) return targets;

  const serverSettings = t`Server settings`;
  targets.push(
    {
      id: "server-settings",
      title: serverSettings,
      path: server.name,
      keywords: ["edit server", "network", "connection"],
      page: { kind: "serverSettings", serverId },
    },
    ...getServerSettingsSections().map((section) => ({
      id: `server-settings-${section.id}`,
      title: section.label,
      path: serverSettings,
      keywords: section.keywords ?? [],
      page: {
        kind: "serverSettings" as const,
        serverId,
        section: section.id,
      },
    })),
    {
      id: "channel-browser",
      title: t`Browse channels`,
      path: server.name,
      keywords: ["list", "join", "find channel", "directory"],
      page: { kind: "channelBrowser", serverId },
    },
    {
      id: "raw-log",
      title: t`Network log`,
      path: server.name,
      keywords: ["raw", "log", "protocol", "debug", "wire"],
      page: { kind: "rawLog", serverId },
    },
  );

  const channel = ctx.selectedChannel;
  if (!channel) return targets;
  const channelSettings = t`Channel settings`;
  const channelPage = {
    kind: "channelSettings" as const,
    serverId,
    channelName: channel.name,
  };
  targets.push(
    {
      id: "channel-settings",
      title: channelSettings,
      path: channel.name,
      keywords: ["edit channel", "channel options"],
      page: channelPage,
    },
    ...getChannelSettingsSections(
      getChannelSettingsAccess(server, channel),
    ).map((section) => ({
      id: `channel-settings-${section.id}`,
      title: section.label,
      path: `${channelSettings} › ${channel.name}`,
      keywords: section.keywords ?? [],
      page: { ...channelPage, section: section.id },
    })),
  );
  return targets;
}
