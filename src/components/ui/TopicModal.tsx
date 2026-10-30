import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import ircClient from "../../lib/ircClient";
import { hasOpPermission, mircToHtml } from "../../lib/ircUtils";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import type { Channel, User } from "../../types";
import { EnhancedLinkWrapper } from "./LinkWrapper";
import { TextArea } from "./TextInput";

interface TopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel;
  serverId: string;
  currentUser: User | null;
}

export const TopicModal: React.FC<TopicModalProps> = ({
  isOpen,
  onClose,
  channel,
  serverId,
  currentUser,
}) => {
  const [editedTopic, setEditedTopic] = useState(channel.topic || "");

  const currentUserInChannel = channel.users.find(
    (u) => u.username === currentUser?.username,
  );
  const canEdit = hasOpPermission(currentUserInChannel?.status);
  const isDirty = editedTopic !== (channel.topic || "");

  const handleSave = () => {
    ircClient.setTopic(serverId, channel.name, editedTopic);
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={channel.name}
      maxWidth="md"
    >
      <ModalBody>
        {canEdit ? (
          <TextArea
            value={editedTopic}
            onChange={(e) => setEditedTopic(e.target.value)}
            className="w-full p-3 rounded min-h-[120px] resize-y text-sm leading-relaxed focus:outline-none transition-colors bg-discord-dark-400 text-white focus:ring-1 focus:ring-discord-primary"
            placeholder={canEdit ? t`Set a topic…` : t`No topic set`}
            autoFocus
          />
        ) : (
          // Read-only path: render as a div with linkified URLs so the
          // text doesn't sit inside a textarea (which strips markup and
          // can't have clickable links).
          <EnhancedLinkWrapper>
            <section
              className="w-full p-3 rounded min-h-[120px] text-sm leading-relaxed bg-discord-dark-400/60 text-discord-text-muted whitespace-pre-wrap break-words select-text"
              aria-label={t`Channel Topic`}
            >
              {channel.topic ? (
                mircToHtml(channel.topic)
              ) : (
                <span className="italic">No topic set</span>
              )}
            </section>
          </EnhancedLinkWrapper>
        )}
      </ModalBody>

      {canEdit && (
        <ModalFooter>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!isDirty}
            className="ml-auto"
          >
            <Trans>Save</Trans>
          </Button>
        </ModalFooter>
      )}
    </BaseModal>
  );
};

export default TopicModal;
