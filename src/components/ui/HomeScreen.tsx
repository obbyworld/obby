import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { FaHashtag, FaPlus, FaUsers } from "react-icons/fa";
import { isTauri } from "../../lib/platformUtils";
import useStore from "../../store";
import { TextInput } from "./TextInput";

interface DiscoverServer {
  name: string;
  description: string;
  wss?: string;
  ircs?: string;
  obby?: boolean;
  icon?: string;
  users?: number;
  channels?: number;
}

const SERVER_LIST_BASE =
  "https://raw.githubusercontent.com/obbyworld/server-list/refs/heads/main/";

// Icons are files in the server-list repo itself, so we only load paths that
// resolve inside it and never reach an origin the list does not already use.
export function serverIconUrl(icon: string | undefined): string | null {
  if (!icon) return null;
  const url = new URL(icon, SERVER_LIST_BASE);
  return url.href.startsWith(SERVER_LIST_BASE) ? url.href : null;
}

// Most entries carry their size only as a netsplit.de sentence, so we read
// the numbers out of it when the entry has no users/channels fields.
const NETSPLIT_STATS =
  /^(\d+) users, (\d+) channels on average \(via netsplit\.de\)\.?$/;

export function parseNetworkStats(
  description: string,
): { users: number; channels: number } | null {
  const match = NETSPLIT_STATS.exec(description.trim());
  return match ? { users: Number(match[1]), channels: Number(match[2]) } : null;
}

const NetworkStats: React.FC<{ users: number; channels: number }> = ({
  users,
  channels,
}) => (
  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-discord-text-muted">
    <span className="flex items-center gap-1.5" title={t`Users`}>
      <FaUsers className="w-3 h-3" />
      {users.toLocaleString()}
    </span>
    <span className="flex items-center gap-1.5" title={t`Channels`}>
      <FaHashtag className="w-3 h-3" />
      {channels.toLocaleString()}
    </span>
  </span>
);

const ServerSummary: React.FC<{ server: DiscoverServer }> = ({ server }) => {
  const parsed = parseNetworkStats(server.description);
  const stats =
    server.users !== undefined && server.channels !== undefined
      ? { users: server.users, channels: server.channels }
      : parsed;
  return (
    <>
      {!parsed && (
        <span className="text-[13px] text-discord-text-muted line-clamp-2">
          {server.description}
        </span>
      )}
      {stats && <NetworkStats users={stats.users} channels={stats.channels} />}
    </>
  );
};

const ServerTile: React.FC<{ server: DiscoverServer }> = ({ server }) => {
  const [hasIconFailed, setHasIconFailed] = useState(false);
  const iconUrl = serverIconUrl(server.icon);
  if (iconUrl && !hasIconFailed) {
    return (
      <img
        src={iconUrl}
        alt=""
        loading="lazy"
        onError={() => setHasIconFailed(true)}
        className="w-11 h-11 shrink-0 rounded-xl object-cover bg-discord-dark-300"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg font-semibold text-white"
      style={{ backgroundColor: tileColor(server.name) }}
    >
      {server.name
        .replace(/^[^a-z0-9]+/i, "")
        .charAt(0)
        .toUpperCase()}
    </span>
  );
};

const DiscoverGrid = () => {
  const { t } = useLingui();
  const { toggleAddServerModal, connect, isConnecting, connectionError } =
    useStore();
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<DiscoverServer[]>([]);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await fetch(`${SERVER_LIST_BASE}servers.json`);
        if (!response.ok) {
          throw new Error("Failed to fetch servers");
        }
        const data = await response.json();
        setServers(data);
      } catch (error) {
        console.error("Error fetching servers:", error);
      }
    };

    fetchServers();
  }, []); // Empty dependency array ensures this runs only once

  // Browser can only connect via WebSocket — hide servers that don't offer wss.
  // Tauri supports both raw TCP (ircs) and wss, so show all servers with either.
  const filteredServers = servers
    .filter((server) =>
      isTauri() ? !!(server.wss || server.ircs) : !!server.wss,
    )
    .filter(
      (server) =>
        server.name.toLowerCase().includes(query.toLowerCase()) ||
        server.description.toLowerCase().includes(query.toLowerCase()),
    );

  const handleServerClick = (server: DiscoverServer) => {
    const hasWss = !!server.wss;
    const hasIrcs = !!server.ircs;

    // Tauri: prefer raw TCP (ircs); if only wss available, use that.
    // Browser: always wss (non-wss servers are already filtered out above).
    const useWebSocket = isTauri() ? !hasIrcs : true;
    const uri = isTauri()
      ? useWebSocket
        ? server.wss
        : (server.ircs ?? server.wss)
      : server.wss;
    if (!uri) return;
    const parsed = new URL(uri);

    // Lock the WSS toggle when only one protocol is available (Tauri only).
    const lockWebSocket = isTauri() && !(hasWss && hasIrcs);

    toggleAddServerModal(true, {
      name: server.name,
      // Pass the full URI so ircClient picks up the correct protocol (wss/ircs).
      // AddServerModal strips the scheme for display when the field is disabled.
      host: uri,
      port: parsed.port || (isTauri() ? "6697" : "443"),
      useWebSocket,
      nickname: "",
      ui: {
        disableServerConnectionInfo: true,
        title: server.name,
        lockWebSocket,
      },
    });
  };

  return __HIDE_SERVER_LIST__ ? (
    <div className="h-full flex flex-col overflow-hidden bg-discord-dark-200 text-white">
      <div className="m-1 rounded z-10 bg-discord-dark-300 border-b border-discord-dark-500 p-4">
        <h1 className="rounded-lg text-2xl font-bold mb-2">
          <Trans>Welcome to {__DEFAULT_IRC_SERVER_NAME__}!</Trans>
        </h1>
      </div>
    </div>
  ) : (
    <div className="h-full flex flex-col overflow-hidden bg-discord-dark-200 text-white">
      <div className="px-4 pt-6 pb-1 flex-shrink-0 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">
          <Trans>Discover the world of IRC with Obby</Trans>
        </h1>

        <div className="bg-discord-dark-400 rounded-lg flex items-center px-2 h-10">
          <button className="px-2 text-discord-text-muted hover:text-discord-text-normal">
            <a
              href="https://github.com/obbyworld/server-list"
              target="_blank"
              rel="noreferrer"
            >
              <FaPlus />
            </a>
          </button>
          <TextInput
            placeholder={t`Search servers...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent border-none outline-none flex-grow text-discord-text-normal placeholder-discord-text-muted"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {filteredServers.length > 0 ? (
          <div className="grid p-4 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {filteredServers.map((server) => (
              <button
                type="button"
                key={server.name}
                className="flex items-start gap-3 text-left bg-discord-dark-100 rounded-xl p-3.5 ring-1 ring-white/[0.04] transition-colors hover:bg-discord-dark-300 hover:ring-white/[0.08]"
                onClick={() => handleServerClick(server)}
              >
                <ServerTile server={server} />
                <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <span className="truncate text-[15px] font-semibold">
                    {server.name}
                  </span>
                  <ServerSummary server={server} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="p-4 text-discord-text-muted">
            <Trans>No servers found.</Trans>
          </p>
        )}
      </div>
    </div>
  );
};

// A stable, muted hue per network name, so every card gets its own color
// without loading a remote icon.
function tileColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 42% 38%)`;
}

export default DiscoverGrid;
