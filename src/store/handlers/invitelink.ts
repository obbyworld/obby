/**
 * Store-side ingestion for obbyircd INVITELINK responses.
 *
 * Three event sources feed into the same per-server cache:
 *
 *   INVITELINK_ENTRY    -- one row of `INVITELINK LIST`. Append.
 *   INVITELINK_CREATED  -- response to `INVITELINK CREATE`. Prepend
 *                          (newest-first ordering matches the LIST
 *                          query, which is ORDER BY created_at DESC).
 *   NOTE / FAIL (command="INVITELINK")
 *                       -- LIST_END flips loading off; DELETED prunes
 *                          the entry; FAIL flips loading off + sets
 *                          an error string.
 *
 * Cap-gating: nothing here forces the obby.world/invitation cap to
 * be negotiated. Commands sent on servers that don't support the
 * INVITELINK protocol will just get an "unknown command" reply from
 * the server (FAIL won't trigger this handler since `command` won't
 * be "INVITELINK"), and the loading flag will stay true until the
 * caller times out.  Components that consume `inviteLinks[serverId]`
 * should check `server.capabilities` for `obby.world/invitation`
 * before issuing `loadInvitations`.
 */
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { AppState } from "../index";

export function registerInvitelinkHandlers(store: StoreApi<AppState>): void {
  ircClient.on("INVITELINK_ENTRY", (entry) => {
    store.setState((state) => {
      const existing = state.inviteLinks[entry.serverId] ?? {
        entries: [],
        loading: true,
      };
      // De-dup on share-id in case the server re-emits.
      const without = existing.entries.filter(
        (e) => e.shareId !== entry.shareId,
      );
      return {
        inviteLinks: {
          ...state.inviteLinks,
          [entry.serverId]: {
            ...existing,
            entries: [
              ...without,
              {
                shareId: entry.shareId,
                channel: entry.channel,
                createdAt: entry.createdAt,
                redeemCount: entry.redeemCount,
                url: entry.url,
                description: entry.description,
              },
            ],
          },
        },
      };
    });
  });

  ircClient.on("INVITELINK_CREATED", (entry) => {
    store.setState((state) => {
      const existing = state.inviteLinks[entry.serverId] ?? {
        entries: [],
        loading: false,
      };
      return {
        inviteLinks: {
          ...state.inviteLinks,
          [entry.serverId]: {
            ...existing,
            entries: [
              {
                shareId: entry.shareId,
                channel: entry.channel,
                /* CREATE doesn't echo a created_at; the server stamps
                 * the row at INSERT time and a fresh LIST will pull
                 * the real value.  Use the current wall clock as a
                 * sensible placeholder for sort ordering. */
                createdAt: new Date().toISOString(),
                redeemCount: 0,
                url: entry.url,
              },
              ...existing.entries.filter((e) => e.shareId !== entry.shareId),
            ],
          },
        },
      };
    });
  });

  // LIST_END / DELETED arrive as the generic NOTE event with
  // command="INVITELINK".
  ircClient.on("NOTE", ({ serverId, command, code, context }) => {
    if (command !== "INVITELINK") return;
    if (code === "LIST_END") {
      store.setState((state) => {
        const existing = state.inviteLinks[serverId];
        if (!existing) return state;
        return {
          inviteLinks: {
            ...state.inviteLinks,
            [serverId]: {
              ...existing,
              loading: false,
              lastFetched: Date.now(),
            },
          },
        };
      });
    } else if (code === "DELETED") {
      const shareId = context[0];
      if (!shareId) return;
      store.setState((state) => {
        const existing = state.inviteLinks[serverId];
        if (!existing) return state;
        return {
          inviteLinks: {
            ...state.inviteLinks,
            [serverId]: {
              ...existing,
              entries: existing.entries.filter((e) => e.shareId !== shareId),
            },
          },
        };
      });
    }
  });

  ircClient.on("FAIL", ({ serverId, command, message }) => {
    if (command !== "INVITELINK") return;
    store.setState((state) => {
      const existing = state.inviteLinks[serverId] ?? {
        entries: [],
        loading: false,
      };
      return {
        inviteLinks: {
          ...state.inviteLinks,
          [serverId]: {
            ...existing,
            loading: false,
            error: message,
          },
        },
      };
    });
  });
}
