import type { ServerConfig } from "../types";
import type {
  ChannelOrderMap,
  GlobalSettings,
  PinnedPrivateChatsMap,
  SavedMetadata,
  UISelections,
} from "./types";

const KEYS = {
  SERVERS: "savedServers",
  METADATA: "serverMetadata",
  SETTINGS: "globalSettings",
  CHANNEL_ORDER: "channelOrder",
  PINNED_PMS: "pinnedPrivateChats",
  UI_SELECTION: "uiSelections",
  MIGRATION_VERSION: "migrationVersion",
} as const;

export const servers = {
  load: (): ServerConfig[] => {
    const data = JSON.parse(localStorage.getItem(KEYS.SERVERS) || "[]");
    return [...data].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  },

  save: (servers: ServerConfig[]) => {
    localStorage.setItem(KEYS.SERVERS, JSON.stringify(servers));
  },
};

// In-memory metadata cache. We intentionally do NOT persist user/channel
// metadata across page reloads: with random-uuid nicks (cat-bot tests)
// or rapidly-rotating display-names, stale entries pollute resolveUser-
// Metadata and the metadataList skip-if-cached check, making the
// nicklist look blank even after a fresh GET would have populated it.
// Memory-only is fine because (a) we lazy-GET on visibility anyway, and
// (b) localStorage churn from constant metadata writes wasn't paying
// for itself. Wipe any pre-existing key so old persisted data doesn't
// hang around in localStorage forever.
try {
  localStorage.removeItem(KEYS.METADATA);
} catch {
  // private-window or storage-disabled -- not fatal
}
let metadataCache: SavedMetadata = {};
export const metadata = {
  load: (): SavedMetadata => metadataCache,
  save: (data: SavedMetadata) => {
    metadataCache = data;
  },
};

export const settings = {
  load: (): Partial<GlobalSettings> => {
    try {
      const raw = JSON.parse(
        localStorage.getItem(KEYS.SETTINGS) || "{}",
      ) as Record<string, unknown>;

      // Migrate old 3-boolean format to the single level enum.
      // Most-permissive flag wins so existing preferences are preserved.
      if (!("mediaVisibilityLevel" in raw)) {
        raw.mediaVisibilityLevel = raw.showExternalContent
          ? 3
          : raw.showTrustedSourcesMedia
            ? 2
            : raw.showSafeMedia === false
              ? 0
              : 1;
        delete raw.showSafeMedia;
        delete raw.showTrustedSourcesMedia;
        delete raw.showExternalContent;
      }

      return raw as Partial<GlobalSettings>;
    } catch {
      return {};
    }
  },

  save: (data: GlobalSettings) => {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(data));
  },
};

export const channelOrder = {
  load: (): ChannelOrderMap => {
    return JSON.parse(localStorage.getItem(KEYS.CHANNEL_ORDER) || "{}");
  },

  save: (data: ChannelOrderMap) => {
    localStorage.setItem(KEYS.CHANNEL_ORDER, JSON.stringify(data));
  },
};

export const pinnedChats = {
  load: (): PinnedPrivateChatsMap => {
    try {
      return JSON.parse(localStorage.getItem(KEYS.PINNED_PMS) || "{}");
    } catch {
      return {};
    }
  },

  save: (data: PinnedPrivateChatsMap) => {
    localStorage.setItem(KEYS.PINNED_PMS, JSON.stringify(data));
  },
};

export const uiSelections = {
  load: (): UISelections => {
    try {
      const saved = localStorage.getItem(KEYS.UI_SELECTION);
      if (!saved) {
        return { selectedServerId: null, perServerSelections: {} };
      }
      return JSON.parse(saved);
    } catch {
      return { selectedServerId: null, perServerSelections: {} };
    }
  },

  save: (data: UISelections) => {
    localStorage.setItem(KEYS.UI_SELECTION, JSON.stringify(data));
  },
};

export const migrationVersion = {
  get: (): number => {
    return Number.parseInt(
      localStorage.getItem(KEYS.MIGRATION_VERSION) || "0",
      10,
    );
  },

  set: (version: number) => {
    localStorage.setItem(KEYS.MIGRATION_VERSION, version.toString());
  },
};

export type {
  ChannelOrderMap,
  GlobalSettings,
  PinnedPrivateChatsMap,
  SavedMetadata,
  UISelections,
};
export { KEYS };
