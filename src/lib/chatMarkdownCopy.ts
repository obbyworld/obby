/**
 * Markdown serialization for copying chat selections.
 *
 * The rendered DOM strips markdown (code fences, links, emphasis) down to plain
 * text and hides author/timestamp from the selection, so a raw browser copy
 * loses both the structure and who said what. Each message row carries its
 * original markdown source plus author/time in data attributes; on copy we walk
 * the selected rows and rebuild a Discord-style markdown transcript from those.
 */

export interface MessageCopyData {
  author: string;
  time: string;
  source: string;
}

/**
 * Author label for a copied message. Includes the underlying nick alongside a
 * display name (e.g. "Brazil ⇨ Germany (mattf)") so the transcript stays
 * attributable even when display names are decorative or collide.
 */
export function formatCopyAuthor(
  displayName: string | undefined | null,
  username: string,
  isSystem = false,
): string {
  if (isSystem) return "System";
  if (displayName && displayName !== username) {
    return `${displayName} (${username})`;
  }
  return displayName || username;
}

/** Normalizes a raw message body for copying (unwraps CTCP ACTION, trims). */
export function normalizeCopySource(raw: string): string {
  // CTCP ACTION (/me) arrives as "ACTION <text>" once the  markers are stripped.
  const action = /^ACTION (.*)$/s.exec(raw);
  const text = action ? `* ${action[1]}` : raw;
  return text.replace(/\s+$/, "");
}

/**
 * Builds a markdown transcript. Consecutive messages from the same author share
 * one "author — time" header, mirroring how the chat groups them visually.
 */
export function serializeMessagesToMarkdown(
  messages: MessageCopyData[],
): string {
  const blocks: string[] = [];
  let prevAuthor: string | null = null;
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };

  for (const msg of messages) {
    const source = normalizeCopySource(msg.source);
    if (msg.author !== prevAuthor) {
      flush();
      current.push(`**${msg.author}** — ${msg.time}`);
      prevAuthor = msg.author;
    }
    if (source) current.push(source);
  }
  flush();

  return blocks.join("\n\n");
}

/** Reads the per-message copy data attributes, falling back to visible text. */
export function readMessageCopyData(el: HTMLElement): MessageCopyData | null {
  const author = el.getAttribute("data-md-author");
  const time = el.getAttribute("data-md-time");
  if (author === null || time === null) return null;
  const source = el.getAttribute("data-md-source");
  return {
    author,
    time,
    // Rows without an explicit source (events, system) copy their visible text.
    source: source ?? el.textContent ?? "",
  };
}

function rangeForNode(node: Node): Range {
  const r = node.ownerDocument?.createRange() ?? document.createRange();
  r.selectNode(node);
  return r;
}

/** True when `range` overlaps `node` at all (even partially). */
function rangeIntersectsNode(range: Range, node: Node): boolean {
  const nodeRange = rangeForNode(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
  );
}

/** True when `range` fully encloses `node`. */
function rangeCoversNode(range: Range, node: Node): boolean {
  const nodeRange = rangeForNode(node);
  return (
    range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
  );
}

/** Selected message rows in document order, deduped across multi-range selections. */
export function messageNodesInSelection(
  selection: Selection,
  root: ParentNode,
): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>("[data-message-id]"),
  );
  if (candidates.length === 0) return [];

  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    ranges.push(selection.getRangeAt(i));
  }
  return candidates.filter((node) =>
    ranges.some((range) => rangeIntersectsNode(range, node)),
  );
}

/**
 * Markdown for the current selection, or null when the caller should let the
 * browser perform its native copy. Native copy is preferred for a partial
 * selection inside a single message (the user is grabbing a substring); markdown
 * is produced for any multi-message selection or a fully-selected single message
 * (where the rendered text would otherwise lose its markdown and author).
 */
export function buildMarkdownFromSelection(
  selection: Selection | null,
  root: ParentNode,
): string | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const nodes = messageNodesInSelection(selection, root);
  if (nodes.length === 0) return null;

  if (nodes.length === 1) {
    const ranges = Array.from({ length: selection.rangeCount }, (_, i) =>
      selection.getRangeAt(i),
    );
    if (!ranges.some((range) => rangeCoversNode(range, nodes[0]))) {
      return null;
    }
  }

  const data = nodes
    .map(readMessageCopyData)
    .filter((d): d is MessageCopyData => d !== null);
  if (data.length === 0) return null;

  return serializeMessagesToMarkdown(data);
}
