import type { SearchQuery, SearchScope } from "./searchTypes";

const FILTER_TOKEN = /^(from|in|mentions|has|before|after):(\S+)$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string): number | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.getTime();
}

export function formatDate(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Tokens we cannot understand stay in the text so the user sees them searched
// literally, except an `in:` naming no chat, which is still being typed.
export function parseSearchInput(
  input: string,
  scope: SearchScope,
  resolveIn: (value: string) => SearchScope | null = () => null,
): SearchQuery {
  const query: SearchQuery = { text: "", scope };
  const words: string[] = [];
  for (const word of input.split(/\s+/).filter(Boolean)) {
    const match = FILTER_TOKEN.exec(word);
    const key = match?.[1].toLowerCase();
    if (!match || !key) words.push(word);
    else if (!applyFilter(query, key, match[2], resolveIn) && key !== "in")
      words.push(word);
  }
  query.text = words.join(" ");
  return query;
}

function applyFilter(
  query: SearchQuery,
  key: string,
  value: string,
  resolveIn: (value: string) => SearchScope | null,
): boolean {
  switch (key) {
    case "from":
      query.from = value.replace(/^@/, "");
      return true;
    case "in": {
      const scope = resolveIn(value);
      if (scope) query.scope = scope;
      return scope !== null;
    }
    case "mentions":
      if (value.toLowerCase() === "me") query.aboutMe = true;
      else query.mentions = value.replace(/^@/, "");
      return true;
    case "has":
      if (value.toLowerCase() !== "link") return false;
      query.hasLink = true;
      return true;
    case "before": {
      const time = parseDate(value);
      if (time === undefined) return false;
      query.before = time;
      return true;
    }
    case "after": {
      const time = parseDate(value);
      if (time === undefined) return false;
      query.after = time;
      return true;
    }
  }
  return false;
}

// We leave the scope out because the palette shows it as a chip next to the text.
export function serializeSearchQuery(query: SearchQuery): string {
  return [
    query.text,
    query.from && `from:${query.from}`,
    query.aboutMe && "mentions:me",
    query.mentions && `mentions:${query.mentions}`,
    query.hasLink && "has:link",
    query.after !== undefined && `after:${formatDate(query.after)}`,
    query.before !== undefined && `before:${formatDate(query.before)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function widenScope(scope: SearchScope): SearchScope {
  if (scope.kind === "chat")
    return { kind: "network", serverId: scope.serverId };
  return { kind: "everywhere" };
}

export function daysAgo(days: number, now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

export const MENTIONS_TOKEN = "mentions:me";
export const LINK_TOKEN = "has:link";

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

export const hasSearchToken = (text: string, token: string) =>
  wordsOf(text.toLowerCase()).includes(token);

export function appendSearchToken(text: string, token: string): string {
  const base = text.trimEnd();
  return base ? `${base} ${token}` : token;
}

export function toggleSearchToken(text: string, token: string): string {
  if (!hasSearchToken(text, token)) return appendSearchToken(text, `${token} `);
  return wordsOf(text)
    .filter((word) => word.toLowerCase() !== token)
    .join(" ");
}

export function removeSearchFilter(text: string, key: string): string {
  const prefix = `${key}:`;
  return wordsOf(text)
    .filter((word) => !word.toLowerCase().startsWith(prefix))
    .join(" ");
}

export function hasFilledToken(text: string, prefix: string): boolean {
  return wordsOf(text).some(
    (word) =>
      word.length > prefix.length && word.toLowerCase().startsWith(prefix),
  );
}

export interface FilterToken {
  key: string;
  value: string;
  start: number;
  end: number;
}

// We find the `key:value` word the caret sits in, so completions can replace just that word.
export function filterTokenAt(
  text: string,
  caret: number,
  keys: readonly string[],
): FilterToken | null {
  const start = text.slice(0, caret).search(/\S*$/);
  const tail = text.slice(caret).match(/^\S*/)?.[0] ?? "";
  const word = text.slice(start, caret + tail.length);
  const colon = word.indexOf(":");
  if (colon < 0) return null;
  const key = word.slice(0, colon).toLowerCase();
  if (!keys.includes(key)) return null;
  return {
    key,
    value: word.slice(colon + 1),
    start,
    end: caret + tail.length,
  };
}
