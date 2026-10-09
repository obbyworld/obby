import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

export const RemoveServerConfirmModal: React.FC = () => {
  const server = useStore((s) =>
    s.servers.find((server) => server.id === s.ui.removeServerConfirmTarget),
  );
  return server ? (
    <RemoveServerDialog key={server.id} name={server.name} />
  ) : null;
};

const RemoveServerDialog: React.FC<{ name: string }> = ({ name }) => {
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
        <p className="text-sm text-discord-text-muted">
          <Trans>
            Add this network again to get its saved chat history back.
          </Trans>
        </p>
        <label className="flex items-center gap-2 text-sm text-discord-text-normal">
          <input
            type="checkbox"
            checked={shouldDeleteHistory}
            onChange={(event) => setShouldDeleteHistory(event.target.checked)}
            className="accent-discord-primary rounded"
          />
          <Trans>Delete its saved chat history too</Trans>
        </label>
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
