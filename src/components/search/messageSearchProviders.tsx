import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { FaCalendarAlt, FaHashtag, FaServer, FaUser } from "react-icons/fa";
import type {
  CompletionProvider,
  CompletionRange,
} from "../../hooks/useCompletion";
import { bestMatches } from "../../lib/fuzzySearch";
import {
  daysAgo,
  filterTokenAt,
  formatDate,
} from "../../lib/search/searchQuery";
import {
  nicksInScope,
  type ScopeTarget,
  scopeServerId,
  scopeTargets,
} from "../../lib/search/searchScope";
import type { SearchScope } from "../../lib/search/searchTypes";
import { listSavedSenders } from "../../store/handlers/history";
import type { Server } from "../../types";

const MAX_ITEMS = 8;

interface DatePreset {
  label: string;
  time: number;
}

export type SearchCompletionItem = string | ScopeTarget | DatePreset;

function tokenMatcher(keys: readonly string[]) {
  return (text: string, caret: number): CompletionRange | null => {
    const token = filterTokenAt(text, caret, keys);
    return token
      ? { query: token.value, start: token.start, end: token.end }
      : null;
  };
}

function datePresets(): DatePreset[] {
  return [
    { label: t`Today`, time: daysAgo(0) },
    { label: t`Yesterday`, time: daysAgo(1) },
    { label: t`A week ago`, time: daysAgo(7) },
    { label: t`A month ago`, time: daysAgo(30) },
  ];
}

function dateProvider(key: "before" | "after"): CompletionProvider<DatePreset> {
  return {
    title:
      key === "after" ? (
        <Trans>After</Trans>
      ) : (
        <Trans comment="Search filter: messages sent before a date">
          Before
        </Trans>
      ),
    match: tokenMatcher([key]),
    getItems: (query) =>
      datePresets().filter((preset) =>
        formatDate(preset.time).startsWith(query),
      ),
    getKey: (preset) => preset.label,
    renderItem: (preset) => (
      <>
        <FaCalendarAlt className="row-icon" />
        <span className="flex-1 truncate">{preset.label}</span>
        <span className="row-meta">{formatDate(preset.time)}</span>
      </>
    ),
    accept: (preset) => `${key}:${formatDate(preset.time)} `,
  };
}

// Senders from saved history, so `from:` suggests people who are offline.
export function useSavedSenders(): string[] {
  const [nicks, setNicks] = useState<string[]>([]);
  useEffect(() => {
    let isCurrent = true;
    listSavedSenders()
      .then((found) => isCurrent && setNicks(found))
      .catch(() => isCurrent && setNicks([]));
    return () => {
      isCurrent = false;
    };
  }, []);
  return nicks;
}

export function messageSearchProviders(
  servers: Server[],
  scope: SearchScope,
  onPickScope: (scope: SearchScope, range: CompletionRange) => void,
  savedNicks: readonly string[] = [],
): CompletionProvider<SearchCompletionItem>[] {
  const fromProvider: CompletionProvider<string> = {
    title: <Trans>People</Trans>,
    match: tokenMatcher(["from"]),
    getItems: (query) =>
      bestMatches(
        nicksInScope(servers, scope, savedNicks),
        query.replace(/^@/, ""),
        (nick) => nick,
        MAX_ITEMS,
      ),
    getKey: (nick) => nick,
    renderItem: (nick) => (
      <>
        <FaUser className="row-icon" />
        <span className="truncate">{nick}</span>
      </>
    ),
    accept: (nick) => `from:${nick} `,
  };

  const inProvider: CompletionProvider<ScopeTarget> = {
    title: <Trans>Chats and networks</Trans>,
    match: tokenMatcher(["in"]),
    getItems: (query) =>
      bestMatches(
        scopeTargets(servers),
        query,
        (target) => target.label,
        MAX_ITEMS,
      ),
    getKey: (target) =>
      `${target.scope.kind}-${scopeServerId(target.scope)}-${target.label}`,
    renderItem: (target) => (
      <>
        {target.scope.kind === "network" ? (
          <FaServer className="row-icon" />
        ) : (
          <FaHashtag className="row-icon" />
        )}
        <span className="flex-1 truncate">{target.label}</span>
        <span className="row-meta truncate">{target.description}</span>
      </>
    ),
    accept: (target, range) => onPickScope(target.scope, range),
  };

  return [
    fromProvider,
    inProvider,
    dateProvider("after"),
    dateProvider("before"),
  ];
}
