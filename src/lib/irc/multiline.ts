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

// `lines` holds one entry per logical line, already split into the parts that
// fit a single PRIVMSG. A logical line's parts stay in one batch: the receiver
// concatenates them, so a batch break between them lands mid-word.
export function chunkForMultiline(
  lines: readonly (readonly string[])[],
  limits: MultilineLimits,
): string[][][] {
  const batches: string[][][] = [];
  let batch: string[][] = [];
  let lineCount = 0;
  let byteCount = 0;

  const flush = () => {
    if (batch.length === 0) return;
    batches.push(batch);
    batch = [];
    lineCount = 0;
    byteCount = 0;
  };

  for (const line of lines) {
    for (const part of splitToFit(line, limits)) {
      const parts = part.length;
      const bytes = part.reduce((n, p) => n + byteLength(p), 0);
      if (
        batch.length > 0 &&
        (lineCount + parts > limits.maxLines ||
          byteCount + bytes > limits.maxBytes)
      ) {
        flush();
      }
      batch.push([...part]);
      lineCount += parts;
      byteCount += bytes;
    }
  }
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
