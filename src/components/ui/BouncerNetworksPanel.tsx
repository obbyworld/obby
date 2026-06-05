import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaExclamationCircle,
  FaLayerGroup,
  FaPencilAlt,
  FaPlay,
  FaPlus,
} from "react-icons/fa";
import { v5 as uuidv5 } from "uuid";
import useStore from "../../store";
import type { BouncerNetwork } from "../../types";
import { BouncerNetworkForm } from "./BouncerNetworkForm";

interface BouncerNetworksPanelProps {
  bouncerServerId: string;
}

type Mode =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; netid: string };

const STATE_COPY: Record<
  string,
  { label: string; dotClass: string; pulse?: boolean }
> = {
  connected: { label: "Connected", dotClass: "bg-green-400" },
  connecting: { label: "Connecting…", dotClass: "bg-yellow-400", pulse: true },
  disconnected: { label: "Disconnected", dotClass: "bg-discord-text-muted" },
};

// Must mirror CHANNEL_NAMESPACE in src/store/index.ts. The bouncerConnectNetwork
// action derives child server ids by hashing (parentId, netid) under this
// namespace; we recompute it here so the row can tell whether a child binding
// already exists.
const CHILD_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function rankNetwork(n: BouncerNetwork): number {
  const s = n.attributes.state;
  if (s === "connected") return 0;
  if (s === "connecting") return 1;
  if (s === "disconnected") return 2;
  return 3;
}

export const BouncerNetworksPanel: React.FC<BouncerNetworksPanelProps> = ({
  bouncerServerId,
}) => {
  const { t } = useLingui();
  const bouncer = useStore((s) => s.bouncers[bouncerServerId]);
  const server = useStore((s) =>
    s.servers.find((srv) => srv.id === bouncerServerId),
  );
  const servers = useStore((s) => s.servers);
  const bouncerAddNetwork = useStore((s) => s.bouncerAddNetwork);
  const bouncerChangeNetwork = useStore((s) => s.bouncerChangeNetwork);
  const bouncerDelNetwork = useStore((s) => s.bouncerDelNetwork);
  const bouncerConnectNetwork = useStore((s) => s.bouncerConnectNetwork);
  const selectServer = useStore((s) => s.selectServer);

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [confirmedSuccessFor, setConfirmedSuccessFor] = useState<string | null>(
    null,
  );

  const networks = useMemo(() => {
    if (!bouncer) return [];
    return Object.values(bouncer.networks).sort((a, b) => {
      const ra = rankNetwork(a);
      const rb = rankNetwork(b);
      if (ra !== rb) return ra - rb;
      const na = a.attributes.name || a.netid;
      const nb = b.attributes.name || b.netid;
      return na.localeCompare(nb);
    });
  }, [bouncer]);

  // Briefly highlight a row after its ADD/CHANGE/DEL has been acked.
  useEffect(() => {
    if (!confirmedSuccessFor) return;
    const t = setTimeout(() => setConfirmedSuccessFor(null), 1400);
    return () => clearTimeout(t);
  }, [confirmedSuccessFor]);

  // Close the inline form after a brief optimistic delay if no error
  // surfaced -- soju doesn't ack ADDNETWORK explicitly, but a missing
  // FAIL within 500ms is a strong signal it succeeded.
  useEffect(() => {
    if (!bouncer || !pendingFor) return;
    const timer = setTimeout(() => {
      if (!bouncer.lastError) {
        if (pendingFor !== "*") setConfirmedSuccessFor(pendingFor);
        setMode({ kind: "list" });
        setPendingFor(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [bouncer, pendingFor]);

  const lastError = bouncer?.lastError;
  const errorForForm = useMemo(() => {
    if (!lastError || !pendingFor) return undefined;
    if (pendingFor === "*" && lastError.subcommand !== "ADDNETWORK")
      return undefined;
    if (
      pendingFor !== "*" &&
      lastError.netid &&
      lastError.netid !== pendingFor &&
      lastError.netid !== "*"
    )
      return undefined;
    return lastError;
  }, [lastError, pendingFor]);

  const onSubmitAdd = (attrs: Record<string, string>) => {
    setPendingFor("*");
    bouncerAddNetwork(bouncerServerId, attrs);
  };
  const onSubmitEdit = (netid: string, attrs: Record<string, string>) => {
    setPendingFor(netid);
    bouncerChangeNetwork(bouncerServerId, netid, attrs);
  };
  const onDelete = (netid: string) => {
    setPendingFor(netid);
    bouncerDelNetwork(bouncerServerId, netid);
  };
  const onConnectOrOpen = async (netid: string) => {
    const childId = uuidv5(`${bouncerServerId}:${netid}`, CHILD_NAMESPACE);
    const existing = servers.find((s) => s.id === childId);
    if (existing) {
      selectServer(childId, { clearSelection: true });
      return;
    }
    const result = await bouncerConnectNetwork(bouncerServerId, netid);
    // bouncerConnectNetwork seeds an in-memory Server with the computed
    // childId before resolving, so this select call lands on the new row.
    selectServer(childId, { clearSelection: true });
    return result;
  };

  const editingNetwork =
    mode.kind === "edit" ? bouncer?.networks[mode.netid] : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-discord-dark-200 text-discord-text-normal">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-discord-dark-300">
        {mode.kind !== "list" ? (
          <button
            type="button"
            onClick={() => {
              setMode({ kind: "list" });
              setPendingFor(null);
            }}
            className="w-9 h-9 rounded-lg bg-discord-dark-300 hover:bg-discord-dark-400 text-discord-text-muted hover:text-white flex items-center justify-center transition-colors"
            aria-label={t`Back to network list`}
          >
            <FaArrowLeft />
          </button>
        ) : (
          <span className="w-9 h-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
            <FaLayerGroup />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white truncate">
            {mode.kind === "add" ? (
              <Trans>Add Network</Trans>
            ) : mode.kind === "edit" ? (
              <Trans>
                Edit {editingNetwork?.attributes.name || editingNetwork?.netid}
              </Trans>
            ) : (
              <Trans>Networks on {server?.name ?? bouncerServerId}</Trans>
            )}
          </h2>
          {mode.kind === "list" && (
            <p className="text-xs text-discord-text-muted truncate">
              {networks.length === 0 ? (
                <Trans>No upstream networks yet.</Trans>
              ) : (
                <Trans>
                  {networks.length} network
                  {networks.length === 1 ? "" : "s"} — pick one to join
                </Trans>
              )}
            </p>
          )}
        </div>
        {mode.kind === "list" && networks.length > 0 && (
          <button
            type="button"
            onClick={() => setMode({ kind: "add" })}
            className="flex items-center gap-2 px-3 py-2 rounded bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors"
            data-testid="bouncer-add-network-button"
          >
            <FaPlus /> <Trans>Add Network</Trans>
          </button>
        )}
      </header>

      <div className="overflow-y-auto flex-1 min-h-0">
        {mode.kind === "list" && (
          <div>
            {!bouncer?.listed && networks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 p-10 text-discord-text-muted">
                <div className="w-8 h-8 border-2 border-discord-text-muted border-t-transparent rounded-full animate-spin" />
                <p className="text-sm">
                  <Trans>Loading networks from your bouncer…</Trans>
                </p>
              </div>
            ) : networks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 p-16 text-center">
                <FaLayerGroup className="text-5xl text-discord-text-muted" />
                <div className="text-sm text-discord-text-muted max-w-sm">
                  <Trans>
                    Your bouncer doesn't have any networks yet. Add one to get
                    started.
                  </Trans>
                </div>
                <button
                  type="button"
                  onClick={() => setMode({ kind: "add" })}
                  className="mt-2 px-4 py-2 rounded bg-primary hover:bg-primary-hover text-white text-sm font-semibold flex items-center gap-2 transition-colors"
                >
                  <FaPlus /> <Trans>Add your first network</Trans>
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-discord-dark-300/50">
                {networks.map((net) => {
                  const stateKey = net.attributes.state ?? "disconnected";
                  const visual =
                    STATE_COPY[stateKey] ?? STATE_COPY.disconnected;
                  const isHighlighted = confirmedSuccessFor === net.netid;
                  const childId = uuidv5(
                    `${bouncerServerId}:${net.netid}`,
                    CHILD_NAMESPACE,
                  );
                  const childServer = servers.find((s) => s.id === childId);
                  const childOpen = !!childServer;
                  return (
                    <li
                      key={net.netid}
                      className={`group flex items-center gap-4 px-6 py-4 transition-colors ${
                        isHighlighted
                          ? "bg-green-600/10"
                          : "hover:bg-discord-dark-300/30"
                      }`}
                    >
                      <span className="relative flex items-center justify-center shrink-0">
                        <span
                          className={`w-3 h-3 rounded-full ${visual.dotClass}`}
                          role="img"
                          aria-label={visual.label}
                        />
                        {visual.pulse && (
                          <span
                            className={`absolute w-3 h-3 rounded-full ${visual.dotClass} opacity-70 animate-ping`}
                          />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-white truncate">
                            {net.attributes.name || net.netid}
                          </span>
                          <span className="text-xs text-discord-text-muted">
                            {visual.label}
                          </span>
                        </div>
                        <div className="text-xs text-discord-text-muted truncate">
                          {net.attributes.host || <Trans>no host set</Trans>}
                          {net.attributes.port ? `:${net.attributes.port}` : ""}
                          {net.attributes.nickname
                            ? ` · ${net.attributes.nickname}`
                            : ""}
                        </div>
                        {net.attributes.error && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-red-400">
                            <FaExclamationCircle />
                            <span className="truncate">
                              {net.attributes.error}
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMode({ kind: "edit", netid: net.netid })
                        }
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded text-discord-text-muted hover:text-white hover:bg-discord-dark-300"
                        aria-label={t`Edit`}
                        data-testid={`bouncer-row-edit-${net.netid}`}
                      >
                        <FaPencilAlt />
                      </button>
                      <button
                        type="button"
                        onClick={() => onConnectOrOpen(net.netid)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
                          childOpen
                            ? "bg-discord-dark-300 hover:bg-discord-dark-400 text-discord-text-normal"
                            : "bg-primary hover:bg-primary-hover text-white"
                        }`}
                        data-testid={`bouncer-row-connect-${net.netid}`}
                      >
                        {childOpen ? (
                          <>
                            <FaArrowRight />
                            <Trans>Open</Trans>
                          </>
                        ) : (
                          <>
                            <FaPlay />
                            <Trans>Connect</Trans>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {mode.kind === "add" && (
          <BouncerNetworkForm
            errorAttribute={errorForForm?.attribute}
            errorMessage={errorForForm?.description}
            isSaving={pendingFor === "*"}
            onSave={onSubmitAdd}
            onCancel={() => {
              setMode({ kind: "list" });
              setPendingFor(null);
            }}
          />
        )}

        {mode.kind === "edit" && editingNetwork && (
          <BouncerNetworkForm
            initial={editingNetwork.attributes}
            errorAttribute={errorForForm?.attribute}
            errorMessage={errorForForm?.description}
            isSaving={pendingFor === editingNetwork.netid}
            isDeleting={pendingFor === editingNetwork.netid}
            onSave={(attrs) => onSubmitEdit(editingNetwork.netid, attrs)}
            onDelete={() => onDelete(editingNetwork.netid)}
            onCancel={() => {
              setMode({ kind: "list" });
              setPendingFor(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default BouncerNetworksPanel;
