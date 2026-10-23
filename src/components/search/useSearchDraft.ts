import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCompletion } from "../../hooks/useCompletion";
import {
  appendSearchToken,
  parseSearchInput,
  removeSearchFilter,
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
  // The results pane searches as the reader types, picks a scope or toggles a filter.
  isInPane?: boolean;
}

const LIVE_SEARCH_MS = 250;
const COMPLETION_ACCEPT_KEYS = ["Enter", "Tab"];

export function useSearchDraft({
  initialText = "",
  initialScope,
  inputRef,
  isMessageSearch = true,
  keysActive = true,
  isInPane = false,
}: SearchDraftOptions) {
  const servers = useStore((s) => s.servers);
  const openSearchResults = useStore((s) => s.openSearchResults);
  const [text, setText] = useState(initialText);
  const [caret, setCaret] = useState(initialText.length);
  const [baseScope, setBaseScope] = useState(initialScope);
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const searchedTextRef = useRef(initialText);

  const parse = (nextText: string, chipScope: SearchScope) =>
    parseSearchInput(nextText, chipScope, (value) =>
      resolveInScope(servers, chipScope, value),
    );

  const submit = (nextText = text, nextScope = baseScope, isLive = false) => {
    searchedTextRef.current = nextText;
    openSearchResults(parse(nextText, nextScope), {
      isLive,
      isPaneKept: isInPane,
    });
  };

  const replaceText = (next: string, nextCaret = next.length) => {
    setText(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  // A typed `in:` names the scope, so the chip shows it and a pick from the
  // chip menu replaces it.
  const scope = parse(text, baseScope).scope;
  const setScope = (next: SearchScope) => {
    const rest = removeSearchFilter(textRef.current, "in");
    if (rest !== textRef.current) replaceText(rest);
    setBaseScope(next);
    if (isInPane) submit(rest, next, true);
  };

  const savedNicks = useSavedSenders();
  const providers = useMemo(
    () =>
      isMessageSearch
        ? messageSearchProviders(servers, baseScope, savedNicks)
        : [],
    [isMessageSearch, servers, baseScope, savedNicks],
  );

  const completion = useCompletion({
    providers,
    text,
    caret,
    onReplace: replaceText,
    keysActive: keysActive && !isScopeMenuOpen,
    acceptKeys: COMPLETION_ACCEPT_KEYS,
  });

  const toggleToken = (token: string) => {
    const next = toggleSearchToken(text, token);
    replaceText(next);
    if (isInPane) submit(next, baseScope, true);
  };

  // We wait while the completion list is open, since a half-typed filter matches nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: submit reads the latest scope and servers on each render
  useEffect(() => {
    if (!isInPane || completion.isOpen) return;
    if (text.trim() === searchedTextRef.current.trim()) return;
    const timer = setTimeout(
      () => submit(text, baseScope, true),
      LIVE_SEARCH_MS,
    );
    return () => clearTimeout(timer);
  }, [isInPane, text, completion.isOpen]);

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
