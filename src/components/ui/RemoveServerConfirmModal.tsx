import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";
import { SavedHistoryChoice } from "./SavedHistoryChoice";

export const RemoveServerConfirmModal: React.FC = () => {
  const server = useStore((s) =>
    s.servers.find((server) => server.id === s.ui.removeServerConfirmTarget),
  );
  return server ? (
    <RemoveServerDialog key={server.id} id={server.id} name={server.name} />
  ) : null;
};

const RemoveServerDialog: React.FC<{ id: string; name: string }> = ({
  id,
  name,
}) => {
  const confirmRemoveServer = useStore((s) => s.confirmRemoveServer);
  const cancelRemoveServer = useStore((s) => s.cancelRemoveServer);
  const [shouldDeleteHistory, setShouldDeleteHistory] = useState(false);

  return (
    <BaseModal
      isOpen
      onClose={cancelRemoveServer}
      maxWidth="md"
      title={<Trans>Disconnect from {name}?</Trans>}
    >
      <ModalBody className="gap-3">
        <SavedHistoryChoice
          serverIds={[id]}
          shouldDelete={shouldDeleteHistory}
          onChange={setShouldDeleteHistory}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={cancelRemoveServer}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="danger"
          onClick={() => confirmRemoveServer(shouldDeleteHistory)}
        >
          <Trans>Disconnect</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};
