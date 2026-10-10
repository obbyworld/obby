import type React from "react";
import { Fragment, lazy, Suspense } from "react";
import type { AppPage } from "../../store/types";
import { LoadingSpinner } from "../ui/LoadingSpinner";

type PageOf<K extends AppPage["kind"]> = Extract<AppPage, { kind: K }>;
export type PageProps<K extends AppPage["kind"]> = { page: PageOf<K> };

const loaders = {
  settings: () => import("./SettingsPage"),
  serverSettings: () => import("./ServerSettingsPage"),
  channelSettings: () => import("./ChannelSettingsPage"),
  channelBrowser: () => import("./ChannelBrowserPage"),
  bots: () => import("./BotsPage"),
  rawLog: () => import("./RawLogPage"),
  twoFactor: () => import("./TwoFactorPage"),
  emojiPacks: () => import("./EmojiPacksPage"),
};

// Pages stay out of the startup bundle; we fetch them once the app is idle so
// the first open renders in one piece without a loading flash.
export function preloadPages(): void {
  for (const load of Object.values(loaders)) void load();
}

const SettingsPage = lazy(loaders.settings);
const ServerSettingsPage = lazy(loaders.serverSettings);
const ChannelSettingsPage = lazy(loaders.channelSettings);
const ChannelBrowserPage = lazy(loaders.channelBrowser);
const BotsPage = lazy(loaders.bots);
const RawLogPage = lazy(loaders.rawLog);
const TwoFactorPage = lazy(loaders.twoFactor);
const EmojiPacksPage = lazy(loaders.emojiPacks);

function renderPage(page: AppPage) {
  switch (page.kind) {
    case "settings":
      return <SettingsPage page={page} />;
    case "serverSettings":
      return <ServerSettingsPage page={page} />;
    case "channelSettings":
      return <ChannelSettingsPage page={page} />;
    case "channelBrowser":
      return <ChannelBrowserPage page={page} />;
    case "bots":
      return <BotsPage page={page} />;
    case "rawLog":
      return <RawLogPage page={page} />;
    case "twoFactor":
      return <TwoFactorPage page={page} />;
    case "emojiPacks":
      return <EmojiPacksPage page={page} />;
  }
}

// A sub-page of Settings returns to the section that links to it.
export function parentPageOf(page: AppPage): AppPage | null {
  return page.kind === "twoFactor" || page.kind === "emojiPacks"
    ? { kind: "settings", section: "account" }
    : null;
}

// Sections and highlights move within one page; another server or channel is a
// fresh page, so no draft from the previous one can be saved onto it.
function pageInstanceKey(page: AppPage): string {
  const serverId = "serverId" in page ? page.serverId : "";
  const channelName = "channelName" in page ? page.channelName : "";
  return `${page.kind}:${serverId}:${channelName}`;
}

export const PageHost: React.FC<{ page: AppPage }> = ({ page }) => (
  <Suspense
    fallback={
      <div className="flex-1 flex items-center justify-center bg-discord-dark-200">
        <LoadingSpinner />
      </div>
    }
  >
    <Fragment key={pageInstanceKey(page)}>{renderPage(page)}</Fragment>
  </Suspense>
);

export default PageHost;
