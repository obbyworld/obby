// draft/multiline caps a batch by line count and by total bytes, and a server
// refuses an oversized batch whole rather than trimming it (obbyircd answers
// `FAIL BATCH MULTILINE_MAX_LINES`, and the message reaches nobody), so a long
// paste is split across batches before it goes out.

export interface MultilineLimits {
  maxLines: number;
  maxBytes: number;
}

export const UNLIMITED_MULTILINE: MultilineLimits = {
  maxLines: Number.POSITIVE_INFINITY,
  maxBytes: Number.POSITIVE_INFINITY,
};

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

// The cap value looks like `max-bytes=5250,max-lines=15`.
export function parseMultilineLimits(
  capValue: string | undefined,
): MultilineLimits {
  if (!capValue) return UNLIMITED_MULTILINE;
  const limits = { ...UNLIMITED_MULTILINE };
  for (const token of capValue.split(",")) {
    const [key, raw] = token.split("=", 2);
    const value = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (key === "max-lines") limits.maxLines = value;
    if (key === "max-bytes") limits.maxBytes = value;
  }
  return limits;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function closingFence(open: string): string {
  return /^(`+|~+)/.exec(open)?.[1] ?? "```";
}

// Returns the fence still open after `text`, given the one open before it.
// A backtick fence has no backtick in its info string, so ```code``` stays
// inline code.
function fenceAfter(text: string, open: string | null): string | null {
  if (!open) {
    const opener = FENCE_OPEN.exec(text);
    const isFence =
      opener && (opener[1][0] === "~" || !opener[2].includes("`"));
    return isFence ? text.trim() : null;
  }
  const marker = FENCE_CLOSE.exec(text)?.[1];
  const closer = closingFence(open);
  const closes =
    marker && marker[0] === closer[0] && marker.length >= closer.length;
  return closes ? null : open;
}

// `lines` holds one entry per logical line, already split into the parts that
// fit a single PRIVMSG. A logical line's parts stay in one batch: the receiver
// concatenates them, so a batch break between them lands mid-word.
// Each batch arrives as its own message, so a batch that ends inside a code
// fence closes it and the next one reopens it, which keeps every message
// valid markdown on its own.
export function chunkForMultiline(
  lines: readonly (readonly string[])[],
  limits: MultilineLimits,
): string[][][] {
  const batches: string[][][] = [];
  let batch: string[][] = [];
  let lineCount = 0;
  let byteCount = 0;
  let fence: string | null = null;
  const carriesFences = limits.maxLines > 2;

  const add = (part: readonly string[]) => {
    batch.push([...part]);
    lineCount += part.length;
    byteCount += part.reduce((n, p) => n + byteLength(p), 0);
  };

  const flush = () => {
    if (batch.length === 0) return;
    if (fence && carriesFences) batch.push([closingFence(fence)]);
    batches.push(batch);
    batch = [];
    lineCount = 0;
    byteCount = 0;
    if (fence && carriesFences) add([fence]);
  };

  for (const line of lines) {
    const next = fenceAfter(line.join(""), fence);
    const reserve =
      next && carriesFences
        ? { lines: 1, bytes: closingFence(next).length }
        : null;
    const openFence = fence ?? next;
    // A reopened fence and its closer share the batch with each piece.
    const pieceLimits =
      openFence && carriesFences
        ? {
            maxLines: limits.maxLines - 2,
            maxBytes: Math.max(
              1,
              limits.maxBytes -
                byteLength(openFence) -
                byteLength(closingFence(openFence)),
            ),
          }
        : limits;
    for (const part of splitToFit(line, pieceLimits)) {
      const parts = part.length;
      const bytes = part.reduce((n, p) => n + byteLength(p), 0);
      if (
        batch.length > 0 &&
        (lineCount + parts + (reserve?.lines ?? 0) > limits.maxLines ||
          byteCount + bytes + (reserve?.bytes ?? 0) > limits.maxBytes)
      ) {
        flush();
      }
      add(part);
    }
    fence = next;
  }
  fence = null;
  flush();
  return batches;
}

// A line whose own parts fill more than one batch is broken across batches: two
// messages beat one the server refuses.
function splitToFit(
  line: readonly string[],
  limits: MultilineLimits,
): (readonly string[])[] {
  const out: (readonly string[])[] = [];
  let piece: string[] = [];
  let bytes = 0;
  for (const part of line) {
    const partBytes = byteLength(part);
    if (
      piece.length > 0 &&
      (piece.length + 1 > limits.maxLines ||
        bytes + partBytes > limits.maxBytes)
    ) {
      out.push(piece);
      piece = [];
      bytes = 0;
    }
    piece.push(part);
    bytes += partBytes;
  }
  if (piece.length > 0) out.push(piece);
  return out;
}
