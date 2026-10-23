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
  scopeToken,
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

// A value typed out in full is done, so we close the list and Enter searches.
function unlessTyped<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): readonly T[] {
  const typed = query.replace(/^@/, "").toLowerCase();
  return items.some((item) => nameOf(item).toLowerCase() === typed)
    ? []
    : items;
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

function personProvider(
  key: "from" | "mentions",
  nicks: () => string[],
): CompletionProvider<string> {
  return {
    title:
      key === "from" ? (
        <Trans>People</Trans>
      ) : (
        <Trans comment="Search filter: messages that mention a person">
          Mentions of
        </Trans>
      ),
    match: tokenMatcher([key]),
    getItems: (query) =>
      unlessTyped(
        bestMatches(
          nicks(),
          query.replace(/^@/, ""),
          (nick) => nick,
          MAX_ITEMS,
        ),
        query,
        (nick) => nick,
      ),
    getKey: (nick) => nick,
    renderItem: (nick) => (
      <>
        <FaUser className="row-icon" />
        <span className="truncate">{nick}</span>
      </>
    ),
    accept: (nick) => `${key}:${nick} `,
  };
}

export function messageSearchProviders(
  servers: Server[],
  scope: SearchScope,
  savedNicks: readonly string[] = [],
): CompletionProvider<SearchCompletionItem>[] {
  const nicks = () => nicksInScope(servers, scope, savedNicks);

  const inProvider: CompletionProvider<ScopeTarget> = {
    title: <Trans>Chats and networks</Trans>,
    match: tokenMatcher(["in"]),
    getItems: (query) =>
      unlessTyped(
        bestMatches(
          scopeTargets(servers),
          query,
          (target) => target.label,
          MAX_ITEMS,
        ),
        query,
        (target) => scopeToken(target.label),
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
    accept: (target) => `in:${scopeToken(target.label)} `,
  };

  return [
    personProvider("from", nicks),
    personProvider("mentions", () => [
      "me",
      ...nicks().filter((nick) => nick.toLowerCase() !== "me"),
    ]),
    inProvider,
    dateProvider("after"),
    dateProvider("before"),
  ];
}
