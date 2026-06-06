import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { FaPlug, FaTimes } from "react-icons/fa";
import { GiGlassShot } from "react-icons/gi";
import useStore from "../../store";

export const BouncerNetworkDisconnectConfirmModal: React.FC = () => {
  const { t } = useLingui();
  const target = useStore((s) => s.ui.disconnectNetworkConfirmTarget);
  const servers = useStore((s) => s.servers);
  const bouncers = useStore((s) => s.bouncers);
  const cancel = useStore((s) => s.cancelDisconnectNetwork);
  const confirm = useStore((s) => s.confirmDisconnectNetwork);

  const network = useMemo(() => {
    if (!target) return null;
    const child = servers.find((s) => s.id === target.childServerId);
    const attrs =
      bouncers[target.bouncerServerId]?.networks[target.netid]?.attributes;
    const name =
      attrs?.name || child?.networkName || child?.name || `#${target.netid}`;
    const host = attrs?.host || child?.host || "";
    return { name, host };
  }, [target, servers, bouncers]);

  if (!target || !network) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      onClick={cancel}
    >
      <div
        className="bg-discord-dark-200 rounded-lg w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-discord-dark-500 flex items-center justify-between">
          <h2 className="text-white font-bold flex items-center gap-2">
            <GiGlassShot className="text-amber-300" />
            <FaPlug className="text-sky-300 text-sm" />
            <Trans>Disconnect network?</Trans>
          </h2>
          <button
            type="button"
            onClick={cancel}
            className="text-discord-text-muted hover:text-white"
            aria-label={t`Close`}
          >
            <FaTimes />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-sm text-discord-text-normal">
            <Trans>
              Disconnect <span className="font-semibold">{network.name}</span>?
            </Trans>
          </p>
          {network.host && (
            <p className="text-xs text-discord-text-muted">{network.host}</p>
          )}
          <p className="text-xs text-discord-text-muted">
            <Trans>
              This removes the network from your soju bouncer. To use it again,
              you'll need to add it back.
            </Trans>
          </p>
        </div>

        <div className="px-5 py-4 border-t border-discord-dark-500 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-1.5 rounded bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal text-sm"
            data-testid="bouncer-network-disconnect-cancel"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            onClick={confirm}
            className="px-3 py-1.5 rounded bg-discord-red hover:bg-red-700 text-white text-sm font-semibold"
            data-testid="bouncer-network-disconnect-confirm"
          >
            <Trans>Disconnect</Trans>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BouncerNetworkDisconnectConfirmModal;
