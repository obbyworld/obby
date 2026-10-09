import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FaPlug } from "react-icons/fa";
import { GiGlassShot } from "react-icons/gi";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";
import { SavedHistoryChoice } from "./SavedHistoryChoice";

export const BouncerNetworkDisconnectConfirmModal: React.FC = () => {
  const target = useStore((s) => s.ui.disconnectNetworkConfirmTarget);
  const servers = useStore((s) => s.servers);
  const bouncers = useStore((s) => s.bouncers);
  const cancel = useStore((s) => s.cancelDisconnectNetwork);
  const confirm = useStore((s) => s.confirmDisconnectNetwork);
  const [shouldDeleteHistory, setShouldDeleteHistory] = useState(false);
  const childServerId = target?.childServerId;

  useEffect(() => {
    if (childServerId) setShouldDeleteHistory(false);
  }, [childServerId]);

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

  return (
    <BaseModal
      isOpen
      onClose={cancel}
      maxWidth="md"
      title={
        <span className="flex items-center gap-2">
          <GiGlassShot className="text-amber-300" />
          <FaPlug className="text-sky-300 text-sm" />
          <Trans>Disconnect network?</Trans>
        </span>
      }
    >
      <ModalBody className="gap-3">
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
        <SavedHistoryChoice
          serverIds={[target.childServerId]}
          shouldDelete={shouldDeleteHistory}
          onChange={setShouldDeleteHistory}
        />
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={cancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="danger" onClick={() => confirm(shouldDeleteHistory)}>
          <Trans>Disconnect</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default BouncerNetworkDisconnectConfirmModal;
