import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import type { CompletionProvider } from "../../hooks/useCompletion";
import { useSuggestionKeys } from "../../hooks/useSuggestionKeys";
import { BaseModal } from "../../lib/modal/BaseModal";
import type { User } from "../../types";
import SuggestionList from "./SuggestionList";
import { TextInput } from "./TextInput";

interface MemberPickerProps {
  provider: CompletionProvider<User>;
  isOpen: boolean;
  isNarrowView: boolean;
  onSelect: (username: string) => void;
  onClose: () => void;
}

const MAX_FLOATING_MEMBERS = 20;

export function MemberPicker({
  provider,
  isOpen,
  isNarrowView,
  onSelect,
  onClose,
}: MemberPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterText, setFilterText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const members = provider.getItems("");
  const needle = filterText.toLowerCase();
  const shown = isNarrowView
    ? members.filter((u) => u.username.toLowerCase().includes(needle))
    : members.slice(0, MAX_FLOATING_MEMBERS);

  useSuggestionKeys({
    isActive: isOpen,
    count: shown.length,
    selectedIndex,
    onMove: setSelectedIndex,
    onAccept: (index) => {
      // The narrow modal's filter field keeps Enter to dismiss the keyboard.
      if (isNarrowView && document.activeElement?.tagName === "INPUT")
        return false;
      const user = shown[index];
      if (user) onSelect(user.username);
      return true;
    },
    onClose,
  });

  useEffect(() => {
    // BaseModal handles outside clicks for the narrow view.
    if (!isOpen || isNarrowView) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node))
        onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, isNarrowView, onClose]);

  useEffect(() => {
    if (isOpen) return;
    setFilterText("");
    setSelectedIndex(0);
  }, [isOpen]);

  if (!isOpen || members.length === 0) return null;

  if (isNarrowView) {
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
            {shown.map((user, index) => (
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
    <div ref={listRef}>
      <SuggestionList
        title={provider.title}
        items={shown}
        getKey={provider.getKey}
        selectedIndex={selectedIndex}
        onHover={setSelectedIndex}
        onPick={(user) => onSelect(user.username)}
        className="absolute bottom-16 right-4"
        renderItem={provider.renderItem}
      />
    </div>
  );
}

export default MemberPicker;
