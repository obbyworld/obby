export interface ChannelMention {
  start: number;
  end: number;
  name: string;
}

// `#` is a normal channel, `^` is voice and `$` is stream. `&` is left out: it
// is a local channel and reads as an ampersand far more often than as a target.
export const PREFIXES = "#$^";

export type ChannelKind = "text" | "voice" | "stream";

/** Classifies a channel-like name by its leading sigil, or null if it doesn't
 * start with one of the channel prefixes. */
export function classifyChannelName(name: string): ChannelKind | null {
  switch (name[0]) {
    case "#":
      return "text";
    case "^":
      return "voice";
    case "$":
      return "stream";
    default:
      return null;
  }
}

// RFC 2812 forbids space, comma and colon inside a channel name. A mention also
// has to start a word, or every fragment identifier in a URL becomes one.
const MENTION = new RegExp(`(^|[\\s(\\[{<'"])([${PREFIXES}][^\\s,:]+)`, "gu");

// Sentence punctuation is legal in a channel name but almost never meant as
// part of one, so it is trimmed off the end of a candidate.
const TRAILING = /[.,!?;:)\]}>'"]+$/;

/** Finds every channel-like token in a run of plain text. Offsets are relative
 * to `text`. This only reports shape; whether the channel exists is a separate
 * question, and the caller decides what an unknown one should look like. */
export function findChannelMentions(text: string): ChannelMention[] {
  const found: ChannelMention[] = [];
  MENTION.lastIndex = 0;
  let match = MENTION.exec(text);

  while (match !== null) {
    const lead = match[1].length;
    const raw = match[2];
    const name = raw.replace(TRAILING, "");
    // A bare prefix is punctuation, not a channel.
    if (name.length > 1) {
      const start = match.index + lead;
      found.push({ start, end: start + name.length, name });
    }
    // Step back so the character after a trimmed candidate can start the next
    // match, which keeps two mentions in a row from swallowing each other.
    MENTION.lastIndex = match.index + lead + raw.length;
    match = MENTION.exec(text);
  }

  return found;
}
