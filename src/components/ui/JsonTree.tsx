import { plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";

interface JsonTreeProps {
  value: unknown;
  // Containers deeper than this start folded.
  openDepth?: number;
}

const SHORT_STRING = 120;

const StringValue: React.FC<{ text: string }> = ({ text }) => {
  const [isFull, setIsFull] = useState(false);
  const isLong = text.length > SHORT_STRING;
  return (
    <span className="text-emerald-300 break-words">
      "{isLong && !isFull ? `${text.slice(0, SHORT_STRING)}…` : text}"
      {isLong && (
        <button
          type="button"
          className="ml-1.5 text-[11px] text-discord-text-link hover:underline"
          onClick={() => setIsFull(!isFull)}
        >
          {isFull ? <Trans>show less</Trans> : <Trans>show more</Trans>}
        </button>
      )}
    </span>
  );
};

const Primitive: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null)
    return <span className="text-discord-text-muted italic">null</span>;
  if (typeof value === "string") return <StringValue text={value} />;
  if (typeof value === "number")
    return <span className="text-sky-300">{value}</span>;
  if (typeof value === "boolean")
    return <span className="text-purple-300">{String(value)}</span>;
  return <span>{String(value)}</span>;
};

const isContainer = (value: unknown): value is object =>
  value !== null && typeof value === "object";

const Node: React.FC<{
  name?: string;
  value: unknown;
  depth: number;
  openDepth: number;
}> = ({ name, value, depth, openDepth }) => {
  const [isOpen, setIsOpen] = useState(depth < openDepth);
  const label = name !== undefined && (
    <span className="text-discord-text-muted">{name}: </span>
  );

  if (!isContainer(value))
    return (
      <div className="break-words">
        {label}
        <Primitive value={value} />
      </div>
    );

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value);
  const summary = Array.isArray(value)
    ? `[ ${plural(entries.length, { one: "# item", other: "# items" })} ]`
    : `{ ${plural(entries.length, { one: "# key", other: "# keys" })} }`;

  if (entries.length === 0)
    return (
      <div>
        {label}
        <span className="text-discord-text-muted">
          {Array.isArray(value) ? "[ ]" : "{ }"}
        </span>
      </div>
    );

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-0.5 -ml-3.5 hover:text-white"
      >
        <span className="w-3.5 flex justify-center text-discord-text-muted">
          {isOpen ? <FaCaretDown /> : <FaCaretRight />}
        </span>
        {label}
        <span className="text-discord-text-muted">{summary}</span>
      </button>
      {isOpen && (
        <div className="ml-1 pl-3.5 border-l border-discord-dark-500/50">
          {entries.map(([key, child]) => (
            <Node
              key={key}
              name={key}
              value={child}
              depth={depth + 1}
              openDepth={openDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const JSON_TOKEN =
  /"(?:[^"\\\n]|\\.)*"?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function jsonTokenClass(token: string, isKey: boolean): string {
  if (isKey) return "text-discord-text-muted";
  if (token.startsWith('"')) return "text-emerald-300";
  if (token === "null") return "text-discord-text-muted italic";
  if (token === "true" || token === "false") return "text-purple-300";
  return "text-sky-300";
}

// Colors JSON text token by token, which also works on JSON that fails to parse.
export const JsonText: React.FC<{ text: string }> = ({ text }) => {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const token = match[0];
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    const isKey =
      token.startsWith('"') && text.startsWith(":", start + token.length);
    parts.push(
      <span key={start} className={jsonTokenClass(token, isKey)}>
        {token}
      </span>,
    );
    last = start + token.length;
  }
  parts.push(text.slice(last));
  return (
    <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-discord-text-normal">
      {parts}
    </pre>
  );
};

export const JsonTree: React.FC<JsonTreeProps> = ({ value, openDepth = 1 }) => (
  <div className="pl-3.5 font-mono text-xs leading-relaxed">
    <Node value={value} depth={0} openDepth={openDepth} />
  </div>
);

export default JsonTree;
