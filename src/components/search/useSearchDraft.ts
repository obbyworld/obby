import type React from "react";
import { useMemo, useRef, useState } from "react";
import { type CompletionRange, useCompletion } from "../../hooks/useCompletion";
import {
  appendSearchToken,
  parseSearchInput,
  toggleSearchToken,
} from "../../lib/search/searchQuery";
import { resolveInScope } from "../../lib/search/searchScope";
import type { SearchScope } from "../../lib/search/searchTypes";
import useStore from "../../store";
import {
  messageSearchProviders,
  useSavedSenders,
} from "./messageSearchProviders";

interface SearchDraftOptions {
  initialText?: string;
  initialScope: SearchScope;
  inputRef: React.RefObject<HTMLInputElement | null>;
  // Completions are off while the input searches something other than messages.
  isMessageSearch?: boolean;
  keysActive?: boolean;
  // Scope picks and filter toggles run the search straight away.
  submitsOnChange?: boolean;
}

export function useSearchDraft({
  initialText = "",
  initialScope,
  inputRef,
  isMessageSearch = true,
  keysActive = true,
  submitsOnChange = false,
}: SearchDraftOptions) {
  const servers = useStore((s) => s.servers);
  const openSearchResults = useStore((s) => s.openSearchResults);
  const [text, setText] = useState(initialText);
  const [caret, setCaret] = useState(initialText.length);
  const [scope, setScopeState] = useState(initialScope);
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  const submit = (nextText = text, nextScope = scope) =>
    openSearchResults(
      parseSearchInput(nextText, nextScope, (value) =>
        resolveInScope(servers, nextScope, value),
      ),
    );

  const replaceText = (next: string, nextCaret = next.length) => {
    setText(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const setScope = (next: SearchScope, nextText = textRef.current) => {
    setScopeState(next);
    if (submitsOnChange) submit(nextText, next);
  };

  const pickScopeRef =
    useRef<(next: SearchScope, range: CompletionRange) => void>(null);
  const pickScope = (next: SearchScope, range: CompletionRange) => {
    const current = textRef.current;
    const rest = `${current.slice(0, range.start)}${current.slice(range.end)}`
      .replace(/\s+/g, " ")
      .trimStart();
    replaceText(rest, Math.min(range.start, rest.length));
    setScope(next, rest);
  };
  pickScopeRef.current = pickScope;

  const savedNicks = useSavedSenders();
  const providers = useMemo(
    () =>
      isMessageSearch
        ? messageSearchProviders(
            servers,
            scope,
            (next, range) => pickScopeRef.current?.(next, range),
            savedNicks,
          )
        : [],
    [isMessageSearch, servers, scope, savedNicks],
  );

  const completion = useCompletion({
    providers,
    text,
    caret,
    onReplace: replaceText,
    keysActive: keysActive && !isScopeMenuOpen,
  });

  const toggleToken = (token: string) => {
    const next = toggleSearchToken(text, token);
    replaceText(next);
    if (submitsOnChange) submit(next);
  };

  const inputProps = {
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
    },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement>) =>
      setCaret(e.currentTarget.selectionStart ?? text.length),
  };

  return {
    text,
    scope,
    setScope,
    isScopeMenuOpen,
    setIsScopeMenuOpen,
    completion,
    inputProps,
    submit,
    focusInput: () => inputRef.current?.focus(),
    insertToken: (token: string) => replaceText(appendSearchToken(text, token)),
    toggleToken,
  };
}

export type SearchDraft = ReturnType<typeof useSearchDraft>;
