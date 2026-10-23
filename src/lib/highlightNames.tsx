import type React from "react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { findAddressedName } from "./notifications";

/** Where one name sits in a piece of text. */
interface NameRange {
  at: number;
  length: number;
}

/** Every place any of `names` is addressed, left to right and never
 *  overlapping, so two names sharing a stretch of text mark it once. */
function rangesIn(text: string, names: string[]): NameRange[] {
  const found: NameRange[] = [];
  for (const name of names) {
    const length = name.trim().length;
    if (!length) continue;
    for (
      let at = findAddressedName(text, name);
      at !== -1;
      at = findAddressedName(text, name, at + length)
    ) {
      found.push({ at, length });
    }
  }
  found.sort((a, b) => a.at - b.at || b.length - a.length);
  return found.filter(
    (range, index) =>
      index === 0 || range.at >= found[index - 1].at + found[index - 1].length,
  );
}

function markText(text: string, names: string[], key: string): ReactNode {
  const ranges = rangesIn(text, names);
  if (ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.at > cursor) parts.push(text.slice(cursor, range.at));
    parts.push(
      <span className="addressed-name" key={`${key}-${range.at}`}>
        {text.slice(range.at, range.at + range.length)}
      </span>,
    );
    cursor = range.at + range.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** Text that is being quoted rather than spoken, where a name is part of the
 *  sample and marking it would change what the sample says. Markdown bodies are
 *  already out of reach, since those arrive as raw HTML with no children to
 *  walk. */
const QUOTES_TEXT = new Set(["a", "code", "pre", "kbd", "samp"]);

function isVerbatim(node: React.ReactElement): boolean {
  if (typeof node.type === "string" && QUOTES_TEXT.has(node.type)) return true;
  const { style } = node.props as { style?: React.CSSProperties };
  return style?.fontFamily === "monospace";
}

/** Marks every place `names` are addressed inside an already-rendered message
 *  body. Only bare text is touched, so links and IRC colouring come through
 *  whole, and a name inside a URL is part of the address rather than someone
 *  speaking to us. */
export function highlightNames(
  node: ReactNode,
  names: string[],
  key = "n",
): ReactNode {
  if (names.length === 0) return node;
  if (typeof node === "string") return markText(node, names, key);
  if (Array.isArray(node)) {
    return node.map((child, index) =>
      highlightNames(child, names, `${key}-${index}`),
    );
  }
  if (isValidElement(node)) {
    if (isVerbatim(node)) return node;
    const { children } = node.props as { children?: ReactNode };
    if (children === undefined) return node;
    return cloneElement(
      node,
      undefined,
      highlightNames(children, names, `${key}-c`),
    );
  }
  return node;
}
