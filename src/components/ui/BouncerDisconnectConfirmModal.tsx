import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { FaCrown, FaPlug } from "react-icons/fa";
import { GiGlassShot } from "react-icons/gi";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";
import type { Server } from "../../types";

export const BouncerDisconnectConfirmModal: React.FC = () => {
  const targetId = useStore((s) => s.ui.disconnectConfirmTarget);
  const servers = useStore((s) => s.servers);
  const cancelDeleteServer = useStore((s) => s.cancelDeleteServer);
  const deleteServer = useStore((s) => s.deleteServer);

  const { parent, children } = useMemo(() => {
    if (!targetId) return { parent: null as Server | null, children: [] };
    const p = servers.find((s) => s.id === targetId) ?? null;
    const c = servers.filter((s) => s.bouncerServerId === targetId);
    return { parent: p, children: c };
  }, [targetId, servers]);

  if (!targetId || !parent) return null;

  const confirm = () => deleteServer(targetId);

  return (
    <BaseModal
      isOpen
      onClose={cancelDeleteServer}
      maxWidth="md"
      title={
        <span className="flex items-center gap-2">
          <GiGlassShot className="text-amber-300" />
          <FaCrown className="text-yellow-400 text-sm" />
          <Trans>Disconnect from soju bouncer?</Trans>
        </span>
      }
    >
      <ModalBody className="gap-3">
        <p className="text-sm text-discord-text-normal">
          <Trans>
            You're connected to{" "}
            <span className="font-semibold">{parent.name}</span>.
          </Trans>
        </p>
        {children.length > 0 && (
          <>
            <p className="text-sm text-discord-text-muted">
              {children.length === 1 ? (
                <Trans>This will also close the bound network below.</Trans>
              ) : (
                <Trans>
                  This will also close the {children.length} bound networks
                  below.
                </Trans>
              )}
            </p>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
              {children.map((child) => (
                <NetworkCard key={child.id} server={child} />
              ))}
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={cancelDeleteServer}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="danger" onClick={confirm}>
          <Trans>Disconnect</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

const NetworkCard: React.FC<{ server: Server }> = ({ server }) => {
  const label = server.networkName || server.name;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded bg-discord-dark-300 border border-discord-dark-500">
      <div className="w-8 h-8 rounded-md bg-discord-dark-400 flex items-center justify-center relative">
        <span className="text-white text-sm font-semibold">
          {label.charAt(0).toUpperCase()}
        </span>
        <div className="absolute -top-1 -right-1 flex items-center gap-0.5 bg-discord-dark-300 border border-discord-dark-500 rounded-full px-1 py-0.5">
          <GiGlassShot className="text-amber-300 text-[8px]" />
          <FaPlug className="text-sky-300 text-[7px]" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium truncate">{label}</div>
        {server.host && (
          <div className="text-xs text-discord-text-muted truncate">
            {server.host}
          </div>
        )}
      </div>
    </div>
  );
};

export default BouncerDisconnectConfirmModal;
