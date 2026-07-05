import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa";
import { isTauri } from "../../lib/platformUtils";
import useStore from "../../store";
import { TextInput } from "./TextInput";

interface DiscoverServer {
  name: string;
  description: string;
  wss?: string;
  ircs?: string;
  obsidian?: boolean;
}

const DiscoverGrid = () => {
  const { t } = useLingui();
  const { toggleAddServerModal, connect, isConnecting, connectionError } =
    useStore();
  const [query, setQuery] = useState("");
  const [servers, setServers] = useState<DiscoverServer[]>([]);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await fetch(
          "https://raw.githubusercontent.com/obbyworld/server-list/refs/heads/main/servers.json",
        );
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
      <div className="m-1 rounded z-10 bg-discord-dark-300 border-b border-discord-dark-500 p-4 flex-shrink-0">
        <h1 className="rounded-lg text-2xl font-bold mb-2">
          <Trans>Discover the world of IRC with ObsidianIRC</Trans>
        </h1>

        <div className="bg-discord-dark-100 rounded-lg flex items-center px-2 py-2">
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
      <div className="flex-1 overflow-y-auto">
        {filteredServers.length > 0 ? (
          <div className="grid p-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredServers.map((server) => (
              <div
                key={server.name}
                className="bg-discord-dark-300 border border-discord-dark-500 rounded-lg p-4 shadow hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => handleServerClick(server)}
              >
                <h2 className="text-lg font-semibold">{server.name}</h2>
                <p className="text-sm text-discord-text-muted">
                  {server.description}
                </p>
              </div>
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

export default DiscoverGrid;
