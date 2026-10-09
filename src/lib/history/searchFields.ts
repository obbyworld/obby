import { parseMessageTags } from "../ircUtils";
import { stripIrcFormatting } from "../messageFormatter";

export const OWN_LINE_TAG = "obby-own";
const MIN_TERM = 2;
const MAX_TERM = 32;
const WORD = /[\p{L}\p{N}]+/gu;
const LINK = /https?:\/\/\S/i;
const NICK_CHAR = "[\\p{L}\\p{N}_\\-\\[\\]\\\\^{}|`]";
const CTCP_ACTION = "\x01ACTION";

export interface SearchFields {
  nick: string;
  text: string;
  hasLink: boolean;
  isOwn: boolean;
  replyTo?: string;
}

export function stripTags(line: string): string {
  return line.startsWith("@") ? line.slice(line.indexOf(" ") + 1) : line;
}

export function trailingOf(line: string): string {
  let rest = stripTags(line);
  if (rest.startsWith(":")) rest = rest.slice(rest.indexOf(" ") + 1);
  const start = rest.indexOf(" :");
  return start === -1 ? "" : rest.slice(start + 2);
}

export const containsLink = (text: string) => LINK.test(text);

function tagsOf(line: string): Record<string, string> {
  return line.startsWith("@")
    ? parseMessageTags(line.slice(0, line.indexOf(" ")))
    : {};
}

export function senderOf(line: string): string {
  const rest = stripTags(line);
  return rest.startsWith(":") ? rest.slice(1).split(/[! ]/)[0] : "";
}

function unwrapAction(body: string): string {
  if (!body.startsWith(CTCP_ACTION)) return body;
  const end =
    body.length > CTCP_ACTION.length && body.endsWith("\x01") ? -1 : undefined;
  return body.slice(CTCP_ACTION.length, end).replace(/^ /, "");
}

export const plainText = (body: string) =>
  stripIrcFormatting(unwrapAction(body));

// A multiline row is its BATCH start line, the inner lines and the BATCH end.
function bodyOf(lines: string[]): string {
  if (lines.length === 1) return trailingOf(lines[0]);
  return lines.slice(1, -1).reduce((body, line, index) => {
    const isConcat = tagsOf(line)["draft/multiline-concat"] !== undefined;
    const separator = index === 0 || isConcat ? "" : "\n";
    return `${body}${separator}${trailingOf(line)}`;
  }, "");
}

export function searchFieldsOf(raw: string): SearchFields {
  const lines = raw.split("\r\n");
  const tags = tagsOf(lines[0]);
  const text = plainText(bodyOf(lines));
  const replyTo = tags["+draft/reply"] ?? tags["+reply"];
  return {
    nick: senderOf(lines[0]),
    text,
    hasLink: containsLink(text),
    isOwn: tags[OWN_LINE_TAG] === "1",
    ...(replyTo ? { replyTo } : {}),
  };
}

const wordsOf = (text: string): string[] =>
  text.toLowerCase().match(WORD) ?? [];

const longEnough = (words: string[]) => [
  ...new Set(words.filter((word) => word.length >= MIN_TERM)),
];

// We index only the start of a long word (a hash, an id), so a lookup finds
// every word sharing that start and matchesTerms checks the whole word.
export const indexTermOf = (word: string) => word.slice(0, MAX_TERM);

export function termsOf(text: string): string[] {
  return [...new Set(longEnough(wordsOf(text)).map(indexTermOf))];
}

export interface QueryTerms {
  exact: string[];
  prefix?: string;
}

// Every word must match and the last one may still be half typed.
export function queryTermsOf(text: string): QueryTerms {
  const words = wordsOf(text);
  const prefix = words.pop();
  const exact = longEnough(words);
  return prefix ? { exact, prefix } : { exact };
}

export function matchesTerms(text: string, query: QueryTerms): boolean {
  if (!query.prefix) return true;
  const words = wordsOf(text);
  const prefix = query.prefix;
  return (
    query.exact.every((term) => words.includes(term)) &&
    words.some((word) => word.startsWith(prefix))
  );
}

export function mentionsNick(text: string, nick: string): boolean {
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!${NICK_CHAR})@?${escaped}(?!${NICK_CHAR})`, "iu").test(
    text,
  );
}
