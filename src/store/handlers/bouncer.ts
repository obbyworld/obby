import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { BouncerState } from "../../types";
import type { AppState } from "../index";

// Helper that lazily creates a BouncerState entry for a serverId.
// We can't always know in advance which servers will turn out to be
// bouncers, so we treat the first BOUNCER-* event from a serverId as
// implicit setup.
function ensureBouncer(
  state: AppState,
  serverId: string,
  patch: Partial<BouncerState> = {},
): AppState["bouncers"] {
  const existing = state.bouncers[serverId];
  const base: BouncerState = existing ?? {
    serverId,
    supported: false,
    notifyEnabled: false,
    networks: {},
    listed: false,
  };
  return { ...state.bouncers, [serverId]: { ...base, ...patch } };
}

export function registerBouncerHandlers(store: StoreApi<AppState>): void {
  // BOUNCER NETWORK <netid> <attrs|"*">. Either a snapshot (full attrs,
  // e.g. inside a LISTNETWORKS batch or an initial -notify dump) or an
  // incremental update (only changed attrs, in notify mode).
  ircClient.on(
    "BOUNCER_NETWORK",
    ({ serverId, netid, deleted, attributes }) => {
      store.setState((state) => {
        const existing = state.bouncers[serverId];
        const base: BouncerState = existing ?? {
          serverId,
          supported: false,
          notifyEnabled: false,
          networks: {},
          listed: false,
        };
        if (deleted) {
          const { [netid]: _, ...rest } = base.networks;
          return {
            bouncers: {
              ...state.bouncers,
              [serverId]: { ...base, networks: rest },
            },
          };
        }
        // Spec: in notify mode, an attr with an empty value is a deletion
        // for that attr. Merge incoming on top of existing and strip those.
        const prev = base.networks[netid]?.attributes ?? {};
        const merged: Record<string, string> = { ...prev };
        for (const [k, v] of Object.entries(attributes)) {
          if (v === "") delete merged[k];
          else merged[k] = v;
        }
        return {
          bouncers: {
            ...state.bouncers,
            [serverId]: {
              ...base,
              networks: {
                ...base.networks,
                [netid]: { netid, attributes: merged },
              },
            },
          },
        };
      });
    },
  );

  // ACKs from the server confirming our ADD / CHANGE / DEL took effect.
  // The accompanying BOUNCER NETWORK update has already updated state;
  // these events exist primarily so UI can dismiss "saving..." spinners
  // and close modals. The store doesn't need to mutate anything here,
  // but we expose the events to consumers via the IRCClient EventMap.

  // Errors from any subcommand. Stash on the bouncer state so the UI
  // can pick them up reactively (toast / inline form error).
  ircClient.on(
    "BOUNCER_FAIL",
    ({ serverId, code, subcommand, attribute, netid, description }) => {
      store.setState((state) => ({
        bouncers: ensureBouncer(state, serverId, {
          lastError: { code, subcommand, attribute, netid, description },
        }),
      }));
    },
  );

  // CAP ACK plumbing: CAP_ACKNOWLEDGED fires once per acked cap with the
  // cap name in `key`. Mark supported when bouncer-networks is acked, and
  // notifyEnabled when the -notify variant is acked (the latter lets us
  // skip an explicit LISTNETWORKS since the server pushes the initial
  // dump unprompted).
  ircClient.on("CAP_ACKNOWLEDGED", ({ serverId, key }) => {
    const supported = key === "soju.im/bouncer-networks";
    const notify = key === "soju.im/bouncer-networks-notify";
    if (!supported && !notify) return;
    store.setState((state) => ({
      bouncers: ensureBouncer(state, serverId, {
        supported: supported || state.bouncers[serverId]?.supported || false,
        notifyEnabled:
          notify || state.bouncers[serverId]?.notifyEnabled || false,
      }),
    }));
  });

  // ISUPPORT BOUNCER_NETID tells us this connection is currently bound
  // to a specific upstream network. Empty value (or missing) means it's
  // a control connection.
  ircClient.on("ISUPPORT", ({ serverId, key, value }) => {
    if (key !== "BOUNCER_NETID") return;
    store.setState((state) => ({
      bouncers: ensureBouncer(state, serverId, {
        boundNetid: value || undefined,
      }),
    }));
  });

  // BATCH_END for a soju.im/bouncer-networks batch finalises the
  // "listed" flag so the UI can swap from a skeleton to the list. We
  // listen on BATCH_START to know the type and stash it; on BATCH_END
  // we look it up.
  const batchTypes = new Map<string, string>(); // batchId -> type
  ircClient.on("BATCH_START", ({ batchId, type }) => {
    if (type === "soju.im/bouncer-networks") batchTypes.set(batchId, type);
  });
  ircClient.on("BATCH_END", ({ serverId, batchId }) => {
    if (batchTypes.get(batchId) !== "soju.im/bouncer-networks") return;
    batchTypes.delete(batchId);
    store.setState((state) => ({
      bouncers: ensureBouncer(state, serverId, { listed: true }),
    }));
  });
}
