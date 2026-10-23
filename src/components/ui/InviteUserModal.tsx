import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useId, useMemo, useState } from "react";
import { FaUser } from "react-icons/fa";
import {
  type CompletionProvider,
  useCompletion,
} from "../../hooks/useCompletion";
import { bestMatches } from "../../lib/fuzzySearch";
import ircClient from "../../lib/ircClient";
import BaseModal from "../../lib/modal/BaseModal";
import {
  Button,
  Input,
  ModalBody,
  ModalFooter,
} from "../../lib/modal/components";
import useStore from "../../store";
import CompletionList from "./CompletionList";

const MAX_SUGGESTIONS = 8;

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  channelName: string;
}

const InviteUserModal: React.FC<InviteUserModalProps> = ({
  isOpen,
  onClose,
  serverId,
  channelName,
}) => {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const listId = useId();

  // We suggest people from our other channels who are not in this one yet.
  const candidates = useMemo(() => {
    const ownNick = ircClient.getCurrentUser(serverId)?.username;
    const channels = server?.channels ?? [];
    const lowerName = channelName.toLowerCase();
    const members = new Set(
      channels
        .find((c) => c.name.toLowerCase() === lowerName)
        ?.users.map((u) => u.username) ?? [],
    );
    const nicks = new Set<string>();
    for (const channel of channels) {
      for (const user of channel.users) {
        if (user.username !== ownNick && !members.has(user.username))
          nicks.add(user.username);
      }
    }
    return [...nicks].sort((a, b) => a.localeCompare(b));
  }, [server?.channels, serverId, channelName]);

  const nickProvider: CompletionProvider<string> = {
    title: <Trans>People</Trans>,
    match: (text) => ({ query: text.trim(), start: 0, end: text.length }),
    getItems: (needle) =>
      needle
        ? bestMatches(candidates, needle, (nick) => nick, MAX_SUGGESTIONS)
        : [],
    getKey: (nick) => nick,
    renderItem: (nick) => (
      <>
        <FaUser className="row-icon" />
        <span className="truncate">{nick}</span>
      </>
    ),
    accept: (nick) => nick,
  };

  const completion = useCompletion({
    providers: [nickProvider],
    text: username,
    caret: username.length,
    onReplace: (text) => {
      setUsername(text);
      setError("");
    },
    keysActive: isOpen,
  });

  const handleInvite = () => {
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError(t`Please enter a username`);
      return;
    }

    // Send the INVITE command
    ircClient.sendRaw(serverId, `INVITE ${trimmedUsername} ${channelName}`);

    // Close modal and reset
    setUsername("");
    setError("");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInvite();
    }
  };

  const handleClose = () => {
    setUsername("");
    setError("");
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={t`Invite User to ${channelName}`}
      maxWidth="md"
    >
      <ModalBody>
        <Input
          id="username"
          type="text"
          label={t`Username`}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          placeholder={t`Enter username to invite`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={error}
          helperText={t`The user will receive an invitation to join ${channelName}.`}
          autoFocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={completion.isOpen}
          aria-controls={listId}
        />
        <CompletionList
          completion={completion}
          id={listId}
          placement="inline"
          className="mt-1"
        />
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="primary" onClick={handleInvite}>
          <Trans>Send Invite</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default InviteUserModal;
