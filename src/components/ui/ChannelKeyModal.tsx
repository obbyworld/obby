import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

export const ChannelKeyModal: React.FC = () => {
  const { t } = useLingui();
  const prompt = useStore((s) => s.channelKeyPrompt);
  const joinChannel = useStore((s) => s.joinChannel);
  const closeChannelKeyPrompt = useStore((s) => s.closeChannelKeyPrompt);
  const [key, setKey] = useState("");

  useEffect(() => {
    if (prompt) setKey("");
  }, [prompt]);

  if (!prompt) return null;
  const { serverId, channelName, isWrongKey } = prompt;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key) return;
    joinChannel(serverId, channelName, key);
    closeChannelKeyPrompt();
  };

  return (
    <BaseModal
      isOpen
      onClose={closeChannelKeyPrompt}
      maxWidth="sm"
      title={t`Join ${channelName}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col min-h-0 flex-1">
        <ModalBody className="gap-3">
          <input
            type="password"
            autoComplete="off"
            aria-label={t`Channel key`}
            placeholder={t`Channel key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full px-3 py-2 rounded bg-discord-dark-300 text-white focus:outline-none focus:ring-2 focus:ring-discord-primary"
          />
          {isWrongKey && (
            <p className="text-discord-red text-xs">
              <Trans>Wrong key, try again</Trans>
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="submit" variant="primary" disabled={!key}>
            <Trans>Join</Trans>
          </Button>
        </ModalFooter>
      </form>
    </BaseModal>
  );
};

export default ChannelKeyModal;
