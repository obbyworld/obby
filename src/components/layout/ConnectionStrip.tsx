import { t } from "@lingui/core/macro";
import type * as React from "react";
import {
  FaCog,
  FaExclamationTriangle,
  FaRedo,
  FaSignInAlt,
  FaUnlink,
} from "react-icons/fa";
import useStore from "../../store";
import type { Server } from "../../types";
import { editConnection } from "./NetworkMenu";

type Trouble = "lost" | "retrying" | "auth";

function getTrouble(server: Server): Trouble | null {
  if (server.connectionState === "disconnected") return "lost";
  if (server.connectionState === "reconnecting") return "retrying";
  if (server.isConnected && server.saslFailed) return "auth";
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

const actionClass =
  "h-7 px-2.5 rounded flex items-center gap-1.5 text-xs font-semibold";

export const ConnectionStrip: React.FC<{ server: Server }> = ({ server }) => {
  const reconnectServer = useStore((state) => state.reconnectServer);
  const trouble = getTrouble(server);
  if (!trouble) return null;

  const messages: Record<Trouble, string> = {
    lost: t`Connection lost. Reconnect to keep chatting`,
    retrying: t`Reconnecting. Edit the connection if this keeps failing`,
    auth: t`Sign-in failed, so you are chatting as a guest. Log in again or fix your password`,
  };

  return (
    <div
      role="status"
      className={`mb-2 p-2.5 rounded-md border flex flex-col gap-2 ${TONES[trouble]}`}
    >
      <div className="flex items-start gap-2 text-[13px] text-discord-text-normal">
        <span className="mt-0.5">{ICONS[trouble]}</span>
        <span>{messages[trouble]}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trouble !== "retrying" && (
          <button
            type="button"
            className={`${actionClass} button-primary`}
            onClick={() => reconnectServer(server.id)}
          >
            {trouble === "auth" ? <FaSignInAlt /> : <FaRedo />}
            {trouble === "auth" ? t`Log in again` : t`Reconnect`}
          </button>
        )}
        <button
          type="button"
          className={`${actionClass} bg-discord-dark-500/40 text-discord-text-normal hover:bg-discord-dark-500/70 hover:text-white`}
          onClick={() => editConnection(server.id)}
          title={t`Edit connection`}
          aria-label={t`Edit connection`}
        >
          <FaCog />
          {t`Edit`}
        </button>
      </div>
    </div>
  );
};

export default ConnectionStrip;
