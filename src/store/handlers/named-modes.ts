// Store-side wiring for IRCv3 draft/named-modes.
//
// Maintains the per-server `namedModes` registry from RPL_CHMODELIST /
// RPL_UMODELIST and handles incoming PROP changes by translating them
// into the existing chanmode/usermode store paths so the rest of the
// app keeps working without knowing about PROP.

import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import type { NamedModeSpec, Server } from "../../types";
import type { AppState } from "../index";

function applyChannelEntries(
  state: AppState,
  serverId: string,
  entries: NamedModeSpec[],
  isFinal: boolean,
): Pick<AppState, "servers"> {
  const servers = state.servers.map((s: Server) => {
    if (s.id !== serverId) return s;
    const prev = s.namedModes ?? {
      supported: true,
      channelModes: [],
      userModes: [],
    };
    return {
      ...s,
      namedModes: {
        supported: true,
        channelModes: mergeEntries(prev.channelModes, entries, isFinal),
        userModes: prev.userModes,
      },
    };
  });
  return { servers };
}

function applyUserEntries(
  state: AppState,
  serverId: string,
  entries: NamedModeSpec[],
  isFinal: boolean,
): Pick<AppState, "servers"> {
  const servers = state.servers.map((s: Server) => {
    if (s.id !== serverId) return s;
    const prev = s.namedModes ?? {
      supported: true,
      channelModes: [],
      userModes: [],
    };
    return {
      ...s,
      namedModes: {
        supported: true,
        channelModes: prev.channelModes,
        userModes: mergeEntries(prev.userModes, entries, isFinal),
      },
    };
  });
  return { servers };
}

/** Append the current line's entries to the running list. The first
 *  line clears any stale registry; the final line caps the burst. */
function mergeEntries(
  prev: NamedModeSpec[],
  incoming: NamedModeSpec[],
  isFinal: boolean,
): NamedModeSpec[] {
  // The protocol burst comes as `[*] ... [*] ... :final`. Each line is
  // independent; we just concatenate. Callers can rely on isFinal to
  // know when to read the registry.
  // Dedup by name in case the server (or a future re-advertise) sends
  // overlapping entries.
  const merged: NamedModeSpec[] = [...prev];
  for (const entry of incoming) {
    const idx = merged.findIndex((e) => e.name === entry.name);
    if (idx === -1) merged.push(entry);
    else merged[idx] = entry;
  }
  // isFinal could trigger downstream effects (e.g. "registry ready")
  // -- left as a boolean for now since callers can derive from the
  // store directly.
  void isFinal;
  return merged;
}

export function registerNamedModesHandlers(store: StoreApi<AppState>): void {
  ircClient.on(
    "NAMED_MODES_CHANMODE_LIST",
    ({ serverId, entries, isFinal }) => {
      store.setState((state) =>
        applyChannelEntries(state, serverId, entries, isFinal),
      );
    },
  );

  ircClient.on("NAMED_MODES_UMODE_LIST", ({ serverId, entries, isFinal }) => {
    store.setState((state) =>
      applyUserEntries(state, serverId, entries, isFinal),
    );
  });

  // Server-pushed PROP changes are the cap-aware equivalent of MODE.
  // We synthesise a MODE event from the registry-resolved letter so
  // every existing chanmode/usermode handler keeps working without
  // having to learn about PROP. Name-only modes (no letter) have no
  // MODE equivalent and are dropped here; UI surfaces that want them
  // can subscribe to NAMED_MODES_PROP directly.
  ircClient.on("NAMED_MODES_PROP", (event) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === event.serverId);
    if (!server?.namedModes?.supported) return;

    const registry = ircClient.isChannel(event.serverId, event.target)
      ? server.namedModes.channelModes
      : server.namedModes.userModes;

    let modestring = "";
    const modeargs: string[] = [];
    let lastSign: "+" | "-" | "" = "";

    for (const item of event.items) {
      const spec = registry.find((m) => m.name === item.name);
      if (!spec?.letter) {
        // Name-only mode -- no legacy-letter representation. The
        // NAMED_MODES_PROP event still fired for richer subscribers;
        // we just can't fan it through MODE.
        continue;
      }
      if (item.sign !== lastSign) {
        modestring += item.sign;
        lastSign = item.sign;
      }
      modestring += spec.letter;
      if (item.param !== undefined) modeargs.push(item.param);
    }

    if (!modestring) return;

    ircClient.triggerEvent("MODE", {
      serverId: event.serverId,
      mtags: event.mtags,
      sender: event.sender,
      target: event.target,
      modestring,
      modeargs,
    });
  });

  // PROP-list responses (961/960): bridge to the same RPL_CHANNELMODEIS
  // path so the existing channel-modes display picks them up. We build
  // a single +<modestring> + args from the items the server returned.
  // Keyed by serverId+channel so concurrent PROP <chan> queries don't
  // intermix.
  type PropBuf = { items: string[] };
  const propBufs = new Map<string, PropBuf>();
  const bufKey = (serverId: string, channel: string) =>
    `${serverId}\x00${channel}`;

  ircClient.on("NAMED_MODES_PROPLIST", ({ serverId, channel, items }) => {
    const key = bufKey(serverId, channel);
    const buf = propBufs.get(key) ?? { items: [] };
    for (const it of items) buf.items.push(it);
    propBufs.set(key, buf);
  });

  ircClient.on("NAMED_MODES_PROPLIST_END", ({ serverId, channel }) => {
    const key = bufKey(serverId, channel);
    const buf = propBufs.get(key);
    propBufs.delete(key);
    if (!buf) return;

    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server?.namedModes?.supported) return;

    let modestring = "+";
    const modeargs: string[] = [];
    for (const raw of buf.items) {
      const eq = raw.indexOf("=");
      const name = eq === -1 ? raw : raw.slice(0, eq);
      const param = eq === -1 ? undefined : raw.slice(eq + 1);
      const spec = server.namedModes.channelModes.find((m) => m.name === name);
      if (!spec?.letter) continue;
      modestring += spec.letter;
      if (param !== undefined) modeargs.push(param);
    }
    if (modestring === "+") return;

    ircClient.triggerEvent("RPL_CHANNELMODEIS", {
      serverId,
      channelName: channel,
      modestring,
      modeargs,
    });
  });
}
