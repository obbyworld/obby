// draft/persistence settings panel.
//
// Surfaces a tri-state preference (Always on / Always off / Use server
// default) plus a read-only effective-state badge so the user can
// reconcile their preference with what the server is actually doing
// (e.g. their preference is DEFAULT and the server default flipped).
//
// Mounts only when the connection has acked draft/persistence, so we
// can safely call PERSISTENCE GET on first render without spamming
// servers that don't support it.

import type React from "react";
import { useEffect, useState } from "react";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";

interface Props {
  serverId: string;
}

type Pref = "ON" | "OFF" | "DEFAULT";

const OPTIONS: { value: Pref; label: string; helper: string }[] = [
  {
    value: "ON",
    label: "Stay in channels",
    helper:
      "When you disconnect, you remain in your channels as a ghost so you can pick up where you left off when you reconnect with the same account.",
  },
  {
    value: "OFF",
    label: "Leave on disconnect",
    helper:
      "Clean exit when you close the app: you part every channel and the server forgets your session immediately.",
  },
  {
    value: "DEFAULT",
    label: "Use server default",
    helper:
      "Inherit whatever the network operators have configured. Most networks default to keeping you online.",
  },
];

export const PersistenceSettingsPanel: React.FC<Props> = ({ serverId }) => {
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    !!server?.account && !!server.capabilities?.includes("draft/persistence");
  const isConnected = server?.isConnected ?? false;
  const preference = server?.persistencePreference ?? "DEFAULT";
  const effective = server?.persistenceEffective;

  // Refresh on mount in case the cap acked before this panel was open
  // and the deferred GET has already fired (we still want a current
  // read in case the server-wide default has rolled).
  useEffect(() => {
    if (!supported || !isConnected) return;
    ircClient.persistenceGet(serverId);
  }, [serverId, supported, isConnected]);

  // Flip busy off when a STATUS update lands.
  useEffect(() => {
    const onStatus = (p: { serverId: string }) => {
      if (p.serverId === serverId) setBusy(false);
    };
    const onFail = (p: { serverId: string; code: string; message: string }) => {
      if (p.serverId !== serverId) return;
      setBusy(false);
      setError(p.message || `Server rejected the request (${p.code}).`);
    };
    ircClient.on("PERSISTENCE_STATUS", onStatus);
    ircClient.on("PERSISTENCE_FAIL", onFail);
    return () => {
      ircClient.deleteHook("PERSISTENCE_STATUS", onStatus);
      ircClient.deleteHook("PERSISTENCE_FAIL", onFail);
    };
  }, [serverId]);

  if (!supported) return null;

  const apply = (value: Pref) => {
    if (!isConnected || value === preference) return;
    setError(null);
    setBusy(true);
    ircClient.persistenceSet(serverId, value);
  };

  return (
    <div className="space-y-3 p-4 bg-discord-dark-400 rounded">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-discord-text-normal font-medium">
            Session persistence
          </h3>
          <p className="text-discord-text-muted text-sm">
            Stay in your channels even after you disconnect.
          </p>
        </div>
        {effective && (
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              effective === "ON"
                ? "bg-discord-green/20 text-discord-green"
                : "bg-discord-dark-300 text-discord-text-muted"
            }`}
          >
            Currently {effective}
          </span>
        )}
      </div>

      {!isConnected && (
        <p className="text-xs text-discord-text-muted italic">
          Connect to this server to change persistence.
        </p>
      )}

      <div className="space-y-2">
        {OPTIONS.map((opt) => {
          const active = preference === opt.value;
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() => apply(opt.value)}
              disabled={!isConnected || busy}
              className={`w-full text-left rounded p-3 border ${
                active
                  ? "border-discord-primary bg-discord-primary/10"
                  : "border-discord-dark-300 bg-discord-dark-500 hover:bg-discord-dark-300"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full border ${
                    active
                      ? "border-discord-primary bg-discord-primary"
                      : "border-discord-text-muted"
                  }`}
                />
                <span className="text-discord-text-normal text-sm font-medium">
                  {opt.label}
                </span>
                {active && (
                  <span className="ml-auto text-xs text-discord-text-muted">
                    Current
                  </span>
                )}
              </div>
              <p className="text-xs text-discord-text-muted mt-1 ml-5">
                {opt.helper}
              </p>
            </button>
          );
        })}
      </div>

      {error && <p className="text-discord-red text-xs">{error}</p>}
    </div>
  );
};

export default PersistenceSettingsPanel;
