import { t } from "@lingui/core/macro";
import type * as React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  FaCog,
  FaExclamationTriangle,
  FaRedo,
  FaSignInAlt,
  FaTimes,
  FaUnlink,
} from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import useStore from "../../store";
import { getLoginState } from "../../store/helpers";
import type { Server } from "../../types";
import { editConnection } from "./NetworkMenu";

type Trouble = "lost" | "retrying" | "auth";

function getTrouble(server: Server): Trouble | null {
  if (server.isDisabled) return null;
  if (server.connectionState === "disconnected") return "lost";
  if (server.connectionState === "reconnecting") return "retrying";
  if (getLoginState(server) === "failed") return "auth";
  return null;
}

const TONES: Record<Trouble, string> = {
  lost: "bg-amber-500/10 border-amber-500/35",
  retrying: "bg-discord-dark-500/25 border-discord-dark-500/60",
  auth: "bg-red-500/10 border-red-500/35",
};

const ICONS: Record<Trouble, React.ReactNode> = {
  lost: <FaUnlink className="text-amber-400" />,
  retrying: <FaRedo className="text-gray-400 animate-spin" />,
  auth: <FaExclamationTriangle className="text-red-400" />,
};

// Starting up and short network blips pass in a moment, so we only speak up
// once a problem has lasted long enough to need the user.
const SETTLE_MS: Record<Trouble, number> = {
  lost: 4000,
  retrying: 10000,
  auth: 0,
};

// A closed strip stays closed in every view of the server until its problem
// clears, so we keep the dismissals outside the component.
const dismissed = new Map<string, Trouble>();
const listeners = new Set<() => void>();
function setDismissed(serverId: string, trouble: Trouble | null) {
  if (trouble) dismissed.set(serverId, trouble);
  else if (!dismissed.delete(serverId)) return;
  for (const listener of listeners) listener();
}
function useDismissed(serverId: string): Trouble | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed.get(serverId),
  );
}

function useSettledTrouble(trouble: Trouble | null): Trouble | null {
  const [settled, setSettled] = useState<Trouble | null>(null);
  useEffect(() => {
    if (!trouble) return;
    const timer = setTimeout(() => setSettled(trouble), SETTLE_MS[trouble]);
    return () => {
      clearTimeout(timer);
      setSettled(null);
    };
  }, [trouble]);
  return settled === trouble ? trouble : null;
}

export const ConnectionStrip: React.FC<{ server: Server }> = ({ server }) => {
  const reconnectServer = useStore((state) => state.reconnectServer);
  const isTouch = useIsTouchInput();
  const current = getTrouble(server);
  const trouble = useSettledTrouble(current);
  const dismissedTrouble = useDismissed(server.id);
  useEffect(() => {
    if (dismissedTrouble && dismissedTrouble !== current)
      setDismissed(server.id, null);
  }, [server.id, current, dismissedTrouble]);
  if (!trouble || trouble === dismissedTrouble) return null;

  const messages: Record<Trouble, string> = {
    lost: t`Connection lost. Reconnect to keep chatting`,
    retrying: t`Reconnecting. Edit the connection if this keeps failing`,
    auth: t`Sign-in failed, so you are chatting as a guest. Log in again or fix your password`,
  };

  return (
    <div role="status" className={`strip-card ${TONES[trouble]}`}>
      <div className="strip-header">
        <span className="mt-0.5">{ICONS[trouble]}</span>
        <span className="flex-1 min-w-0 break-words">{messages[trouble]}</span>
        <button
          type="button"
          onClick={() => setDismissed(server.id, trouble)}
          title={t`Close`}
          aria-label={t`Close`}
          className={`shrink-0 flex items-center justify-center rounded text-discord-text-muted hover:text-white ${isTouch ? "w-11 h-11 -m-2.5" : "w-5 h-5"}`}
        >
          <FaTimes />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trouble === "auth" ? (
          <button
            type="button"
            className="strip-action button-primary"
            onClick={() =>
              server.bouncerServerId
                ? reconnectServer(server.id)
                : editConnection(server.id, "auth")
            }
          >
            <FaSignInAlt />
            {t`Log in again`}
          </button>
        ) : (
          <>
            {trouble === "lost" && (
              <button
                type="button"
                className="strip-action button-primary"
                onClick={() => reconnectServer(server.id)}
              >
                <FaRedo />
                {t`Reconnect`}
              </button>
            )}
            <button
              type="button"
              className="strip-action bg-discord-dark-500/40 text-discord-text-normal hover:bg-discord-dark-500/70 hover:text-white"
              onClick={() => editConnection(server.id)}
              title={t`Edit connection`}
              aria-label={t`Edit connection`}
            >
              <FaCog />
              {t`Edit`}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ConnectionStrip;
