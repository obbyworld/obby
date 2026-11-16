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

function fenceMarker(text: string): string | undefined {
  return /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
}

// Returns the fence still open after `text`, given the one open before it.
function fenceAfter(text: string, open: string | null): string | null {
  const marker = fenceMarker(text);
  if (!marker) return open;
  if (!open) return text.trim();
  const opener = fenceMarker(open) ?? "";
  const closes = marker[0] === opener[0] && marker.length >= opener.length;
  return closes ? null : open;
}

function closingFence(open: string): string {
  return fenceMarker(open) ?? "```";
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
    for (const part of splitToFit(line, limits)) {
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
