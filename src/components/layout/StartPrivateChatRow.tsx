import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import { FaAt, FaUser } from "react-icons/fa";
import {
  type CompletionProvider,
  useCompletion,
} from "../../hooks/useCompletion";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { bestMatches } from "../../lib/fuzzySearch";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import CompletionList from "../ui/CompletionList";
import InlineEntryRow from "./InlineEntryRow";

const MAX_SUGGESTIONS = 8;

interface StartPrivateChatRowProps {
  serverId: string;
}

export const StartPrivateChatRow: React.FC<StartPrivateChatRowProps> = ({
  serverId,
}) => {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const openChat = useStore((s) => s.openChat);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestionAnchor, setSuggestionAnchor] =
    useState<HTMLDivElement | null>(null);
  const isTouch = useIsTouchInput();
  const listId = useId();

  const peers = useMemo(() => {
    const ownNick = ircClient.getCurrentUser(serverId)?.username;
    const nicks = new Set<string>();
    for (const channel of server?.channels ?? []) {
      for (const user of channel.users) {
        if (user.username !== ownNick) nicks.add(user.username);
      }
    }
    return [...nicks].sort((a, b) => a.localeCompare(b));
  }, [server?.channels, serverId]);

  const close = () => {
    setIsOpen(false);
    setQuery("");
  };

  const messageNick = (nick: string) => {
    openChat(serverId, nick);
    close();
  };

  const nickProvider: CompletionProvider<string> = {
    title: <Trans>People</Trans>,
    match: (text) => ({ query: text.trim(), start: 0, end: text.length }),
    getItems: (needle) =>
      bestMatches(peers, needle, (nick) => nick, MAX_SUGGESTIONS),
    getKey: (nick) => nick,
    renderItem: (nick) => (
      <>
        <FaUser className="row-icon" />
        <span className="truncate">{nick}</span>
      </>
    ),
    accept: (nick) => messageNick(nick),
  };

  const needle = query.trim();
  const completion = useCompletion({
    providers: [nickProvider],
    text: query,
    caret: query.length,
    onReplace: setQuery,
    keysActive: isOpen && needle !== "",
    onDismiss: close,
  });

  const submitTyped = () => {
    if (needle) messageNick(needle);
  };

  return (
    <InlineEntryRow
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      label={t`message someone`}
      icon={<FaAt />}
      value={query}
      onChange={setQuery}
      placeholder={t`nickname`}
      inputLabel={t`Nickname to message`}
      submitLabel={t`Open private chat`}
      onSubmit={submitTyped}
      onClose={close}
      frameRef={setSuggestionAnchor}
      inputAriaProps={{
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": completion.items.length > 0,
        "aria-controls": listId,
        "aria-activedescendant": needle
          ? `${listId}-${completion.selectedIndex}`
          : undefined,
      }}
    >
      <CompletionList
        completion={completion}
        id={listId}
        placement={isTouch ? "inline" : "below"}
        anchor={isTouch ? undefined : suggestionAnchor}
        className={isTouch ? "mt-1" : ""}
        selectedIndex={needle ? completion.selectedIndex : -1}
      />
    </InlineEntryRow>
  );
};

export default StartPrivateChatRow;
