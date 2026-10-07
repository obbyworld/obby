import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import { FaAt, FaUser } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import { fuzzyMatch } from "../../lib/fuzzySearch";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import SuggestionList from "../ui/SuggestionList";
import InlineEntryRow from "./InlineEntryRow";

const MAX_SUGGESTIONS = 8;

interface StartPrivateChatRowProps {
  serverId: string;
}

export const StartPrivateChatRow: React.FC<StartPrivateChatRowProps> = ({
  serverId,
}) => {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const openPrivateChat = useStore((s) => s.openPrivateChat);
  const selectPrivateChat = useStore((s) => s.selectPrivateChat);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  const needle = query.trim();
  const suggestions = useMemo(() => {
    if (!needle) return peers.slice(0, MAX_SUGGESTIONS);
    return peers
      .map((nick) => ({ nick, match: fuzzyMatch(needle, nick) }))
      .filter(({ match }) => match.matches)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, MAX_SUGGESTIONS)
      .map(({ nick }) => nick);
  }, [peers, needle]);

  const close = () => {
    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
  };

  const openChat = (nick: string) => {
    openPrivateChat(serverId, nick);
    const privateChat = useStore
      .getState()
      .servers.find((s) => s.id === serverId)
      ?.privateChats?.find(
        (pc) => pc.username.toLowerCase() === nick.toLowerCase(),
      );
    if (privateChat) selectPrivateChat(privateChat.id, { navigate: true });
    close();
  };

  const submitTyped = () => {
    if (needle) openChat(needle);
  };

  useSuggestionKeys({
    isActive: isOpen && needle !== "",
    count: suggestions.length,
    selectedIndex,
    onMove: setSelectedIndex,
    onAccept: (index) => {
      const nick = suggestions[index];
      if (!nick) return false;
      openChat(nick);
      return true;
    },
    onClose: close,
  });

  return (
    <InlineEntryRow
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      label={t`message someone`}
      icon={<FaAt />}
      value={query}
      onChange={(value) => {
        setQuery(value);
        setSelectedIndex(0);
      }}
      placeholder={t`nickname`}
      inputLabel={t`Nickname to message`}
      submitLabel={t`Open private chat`}
      onSubmit={submitTyped}
      onClose={close}
      frameRef={setSuggestionAnchor}
      inputAriaProps={{
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": suggestions.length > 0,
        "aria-controls": listId,
        "aria-activedescendant": needle
          ? `${listId}-${selectedIndex}`
          : undefined,
      }}
    >
      {suggestions.length > 0 && (
        <SuggestionList
          id={listId}
          placement={isTouch ? "inline" : "below"}
          anchor={isTouch ? undefined : suggestionAnchor}
          className={isTouch ? "mt-1" : ""}
          title={<Trans>People</Trans>}
          items={suggestions}
          getKey={(nick) => nick}
          selectedIndex={needle ? selectedIndex : -1}
          onHover={setSelectedIndex}
          onPick={openChat}
          renderItem={(nick) => (
            <>
              <FaUser className="row-icon" />
              <span className="truncate">{nick}</span>
            </>
          )}
        />
      )}
    </InlineEntryRow>
  );
};

export default StartPrivateChatRow;
