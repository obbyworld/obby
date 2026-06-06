import { v5 as uuidv5 } from "uuid";
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { BouncerState } from "../../types";
import type { AppState } from "../index";

// Mirrors CHANNEL_NAMESPACE in src/store/index.ts -- used to derive the
// deterministic child-server id from (parentId, netid). We recompute it
// here so the auto-bind handler can dedup against an already-existing
// child Server row without round-tripping through the store action.
const CHILD_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Auto-bind networks the bouncer reports as `state=connected`. The user
// asked for this (issue #120 followup): once you've connected a network
// on the bouncer side, the client should follow without a manual click
// -- including across page reloads. `connected` is the only state we
// treat as a follow signal; `connecting` / `disconnected` are left alone.
//
// Dedup uses a module-scope Set keyed by childId rather than re-reading
// state.servers on every call. The store-state check was unreliable
// when the per-event trigger fired multiple BOUNCER_NETWORK events in
// the same tick: each invocation's snapshot read happened before
// preceding sync set()s had visibly committed in some flows, so the
// same network produced multiple seed rows. The Set is cheap and
// correct.
const autoBindAttempted = new Set<string>();

function autoBindConnectedNetworks(
  store: StoreApi<AppState>,
  bouncerServerId: string,
) {
  const state = store.getState();
  const bouncer = state.bouncers[bouncerServerId];
  if (!bouncer) return;
  for (const net of Object.values(bouncer.networks)) {
    if (net.attributes.state !== "connected") continue;
    const childId = uuidv5(`${bouncerServerId}:${net.netid}`, CHILD_NAMESPACE);
    if (autoBindAttempted.has(childId)) continue;
    if (state.servers.some((s) => s.id === childId)) {
      autoBindAttempted.add(childId);
      continue;
    }
    autoBindAttempted.add(childId);
    void state.bouncerConnectNetwork(bouncerServerId, net.netid);
  }
}

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
      // If the post-update network state is `connected`, follow it
      // with a client bind. setState above already committed the
      // attributes, so the auto-binder reads the fresh state.
      if (attributes.state === "connected" || (!deleted && attributes.state)) {
        autoBindConnectedNetworks(store, serverId);
      }
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
    // Initial LISTNETWORKS dump just landed -- this is the post-login
    // moment to auto-bind every network the bouncer reports as
    // connected. Handles the page-reload case: bouncer parent
    // reconnects, sends the listing, we follow each upstream that's
    // still active on the bouncer side without any saved-child state.
    autoBindConnectedNetworks(store, serverId);
  });
}
