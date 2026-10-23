import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import { BaseModal } from "../../lib/modal/BaseModal";
import type { User } from "../../types";
import SuggestionList from "./SuggestionList";
import { TextInput } from "./TextInput";

interface AutocompleteDropdownProps {
  users: User[];
  isVisible: boolean;
  inputValue: string;
  cursorPosition: number;
  onSelect: (username: string) => void;
  onClose: () => void;
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null;
  tabCompletionMatches?: string[];
  currentMatchIndex?: number;
  onNavigate?: (username: string) => void;
  isAtButtonTriggered?: boolean;
  isNarrowView?: boolean;
}

export const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({
  users,
  isVisible,
  inputValue,
  cursorPosition,
  onSelect,
  onClose,
  inputElement,
  tabCompletionMatches = [],
  currentMatchIndex = 0,
  onNavigate,
  isAtButtonTriggered = false,
  isNarrowView = false,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterText, setFilterText] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getCompletionWord = () => {
    const textBeforeCursor = inputValue.substring(0, cursorPosition);
    const words = textBeforeCursor.split(/\s+/);
    return words[words.length - 1] || "";
  };

  const getDisplayUsers = () => {
    // If triggered by @ button, show all users
    if (isAtButtonTriggered) {
      return [...users]
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(0, 20); // Show up to 20 users for @ button
    }

    if (tabCompletionMatches.length > 0) {
      return tabCompletionMatches
        .map((match) => {
          const username = match.replace(/:\s*$/, "").replace(/\s+$/, "");
          return users.find((user) => user.username === username);
        })
        .filter(Boolean) as User[];
    }

    const currentWord = getCompletionWord();
    if (!currentWord) return [];

    return users
      .filter(
        (user) =>
          user.username.toLowerCase().startsWith(currentWord.toLowerCase()) &&
          user.username.toLowerCase() !== currentWord.toLowerCase(),
      )
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 10);
  };

  const displayUsers = getDisplayUsers();

  // Filtered users for modal view
  const filteredUsers =
    isNarrowView && isAtButtonTriggered && filterText
      ? users
          .filter((u) =>
            u.username.toLowerCase().includes(filterText.toLowerCase()),
          )
          .sort((a, b) => a.username.localeCompare(b.username))
      : isNarrowView && isAtButtonTriggered
        ? [...users].sort((a, b) => a.username.localeCompare(b.username))
        : displayUsers;

  useEffect(() => {
    setSelectedIndex(tabCompletionMatches.length > 0 ? currentMatchIndex : 0);
  }, [currentMatchIndex, tabCompletionMatches.length]);

  useSuggestionKeys({
    isActive: isVisible,
    count: displayUsers.length,
    selectedIndex,
    onMove: (index) => {
      setSelectedIndex(index);
      const user = displayUsers[index];
      if (user) onNavigate?.(user.username);
    },
    onAccept: (index) => {
      // In the narrow modal the filter input keeps Enter to dismiss the keyboard.
      if (
        isNarrowView &&
        isAtButtonTriggered &&
        document.activeElement?.tagName === "INPUT"
      )
        return false;
      const user = displayUsers[index];
      if (user) onSelect(user.username);
      return true;
    },
    onClose,
  });

  useEffect(() => {
    if (!isVisible || !isAtButtonTriggered) return;
    // Skip outside-click handler for narrow view modal (BaseModal handles it)
    if (isNarrowView) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isVisible, isAtButtonTriggered, isNarrowView, onClose]);

  // Reset filter text when modal opens/closes
  useEffect(() => {
    if (!isVisible) {
      setFilterText("");
    }
  }, [isVisible]);

  if (!isVisible || displayUsers.length === 0) {
    return null;
  }

  // Narrow view modal for @ button triggered dropdown
  if (isNarrowView && isAtButtonTriggered) {
    return (
      <BaseModal
        isOpen={true}
        onClose={onClose}
        title={t`Select Member`}
        maxWidth="sm"
        closeOnClickOutside={true}
        closeOnEsc={true}
      >
        <div className="p-3 flex flex-col flex-1 min-h-0">
          <TextInput
            placeholder={t`Filter members…`}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full bg-discord-dark-400 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-text-link mb-3 flex-shrink-0"
          />
          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredUsers.map((user, index) => (
              <button
                key={user.id}
                type="button"
                className={`row-interactive py-3 text-base ${
                  index === selectedIndex ? "row-interactive-active" : ""
                }`}
                onClick={() => onSelect(user.username)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="w-8 h-8 rounded-full bg-discord-dark-400 flex items-center justify-center text-sm text-white shrink-0">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 truncate">{user.username}</span>
                {user.isOnline && (
                  <span className="w-2 h-2 rounded-full bg-discord-green shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </BaseModal>
    );
  }

  return (
    <div ref={dropdownRef}>
      <SuggestionList
        title={<Trans>Members</Trans>}
        items={displayUsers}
        getKey={(user) => user.id}
        selectedIndex={selectedIndex}
        onHover={setSelectedIndex}
        onPick={(user) => onSelect(user.username)}
        anchor={isAtButtonTriggered ? null : inputElement}
        className={isAtButtonTriggered ? "absolute bottom-16 right-4" : ""}
        renderItem={(user) => (
          <>
            <span className="w-6 h-6 rounded-full bg-discord-dark-400 flex items-center justify-center text-xs text-white shrink-0">
              {user.username.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0 truncate">{user.username}</span>
            {user.isOnline && (
              <span className="w-2 h-2 rounded-full bg-discord-green shrink-0" />
            )}
          </>
        )}
      />
    </div>
  );
};

export default AutocompleteDropdown;
