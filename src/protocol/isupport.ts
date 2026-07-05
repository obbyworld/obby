import type { IRCClient } from "../lib/ircClient";
import type AppState from "../store/";
import type { Server } from "../types/";

export function registerISupportHandler(
  ircClient: IRCClient,
  useStore: typeof AppState,
) {
  ircClient.on("ISUPPORT", ({ serverId, key, value }) => {
    if (key === "FAVICON" || key === "ICON" || key === "draft/ICON") {
      const favicon = value;
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, icon: favicon };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    if (key === "NETWORK") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, networkName: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    if (key === "PREFIX") {
      const prefix = value;
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, prefix };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    if (key === "CHANMODES") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, chanmodes: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    if (key === "BOT") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, botMode: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    // Vendor token-authenticated uploader. obby's filehost requires an
    // account, so it can't use the tokenless standard draft/FILEHOST; it
    // advertises this vendor token instead, paired with draft/authtoken.
    if (key === "obby.world/FILEHOST") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, filehost: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    // Standard tokenless IRCv3 draft/FILEHOST: a space-separated list of
    // upload endpoints the client POSTs to directly (no auth). parseIsupport
    // has already turned \x20 back into spaces, so just split.
    if (key === "draft/FILEHOST") {
      const hosts = value.split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) =>
          server.id === serverId ? { ...server, fileHosts: hosts } : server,
        );
        return { servers: updatedServers };
      });
      return;
    }

    if (key === "ELIST") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, elist: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }

    // draft/custom-emoji ISUPPORT token: value is the URL of the
    // network-wide pack JSON document.  Stored on the server so the
    // pack fetcher can pick it up after CAP negotiation completes.
    if (key === "draft/EMOJI") {
      useStore.setState((state) => {
        const updatedServers = state.servers.map((server: Server) => {
          if (server.id === serverId) {
            return { ...server, emojiPackUrl: value };
          }
          return server;
        });
        return { servers: updatedServers };
      });
      return;
    }
  });
}
