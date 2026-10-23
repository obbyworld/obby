export interface FuzzyMatchResult {
  matches: boolean;
  /** 0-100, one scale for every kind of result so Ctrl+K can sort them together. */
  score: number;
  /** Matched [start, end) spans in the target, for highlighting. */
  ranges: Array<[number, number]>;
}

const NO_MATCH: FuzzyMatchResult = { matches: false, score: 0, ranges: [] };
const SEPARATOR = /[\s_\-./#:|()[\]&,+@!?'"]/;

function wordStarts(target: string): Set<number> {
  const starts = new Set<number>();
  for (let i = 0; i < target.length; i++) {
    const prev = target[i - 1];
    const char = target[i];
    if (SEPARATOR.test(char)) continue;
    const isCamelHump =
      prev !== undefined &&
      prev === prev.toLowerCase() &&
      prev !== prev.toUpperCase() &&
      char !== char.toLowerCase();
    if (i === 0 || SEPARATOR.test(prev) || isCamelHump) starts.add(i);
  }
  return starts;
}

// Matches the query as pieces that each begin a word, so "shmo" finds
// "SHow the MOtd" while "hwt" finds nothing in it.
function matchWordPieces(
  query: string,
  target: string,
  starts: Set<number>,
  from: number,
): Array<[number, number]> | null {
  if (query.length === 0) return [];
  for (let start = from; start < target.length; start++) {
    if (!starts.has(start) || target[start] !== query[0]) continue;
    let length = 1;
    while (length < query.length && target[start + length] === query[length]) {
      length++;
    }
    for (let take = length; take >= 1; take--) {
      const rest = matchWordPieces(
        query.slice(take),
        target,
        starts,
        start + take,
      );
      if (rest) return [[start, start + take], ...rest];
    }
  }
  return null;
}

export const fuzzyMatch = (query: string, target: string): FuzzyMatchResult => {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: true, score: 0, ranges: [] };
  const haystack = target.toLowerCase();
  const full: Array<[number, number]> = [[0, needle.length]];

  if (haystack === needle) return { matches: true, score: 100, ranges: full };
  if (haystack.startsWith(needle))
    return { matches: true, score: 90, ranges: full };

  const starts = wordStarts(target);
  let wordIndex = 0;
  for (let i = 0; i < haystack.length; i++) {
    if (!starts.has(i)) continue;
    if (haystack.startsWith(needle, i)) {
      return {
        matches: true,
        score: 80 - Math.min(10, wordIndex * 2),
        ranges: [[i, i + needle.length]],
      };
    }
    wordIndex++;
  }

  const tokens = needle.split(/\s+/);
  if (tokens.length > 1) {
    const ranges: Array<[number, number]> = [];
    for (const token of tokens) {
      const at = [...starts].find((i) => haystack.startsWith(token, i));
      if (at === undefined) return NO_MATCH;
      ranges.push([at, at + token.length]);
    }
    return { matches: true, score: 70, ranges };
  }

  const pieces = matchWordPieces(needle, haystack, starts, 0);
  if (pieces) {
    return {
      matches: true,
      score: Math.max(40, 65 - pieces.length * 5),
      ranges: pieces,
    };
  }

  const inside = haystack.indexOf(needle);
  if (needle.length >= 2 && inside >= 0) {
    return {
      matches: true,
      score: 35,
      ranges: [[inside, inside + needle.length]],
    };
  }
  return NO_MATCH;
};

export function bestMatches<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
  limit: number,
): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, match: fuzzyMatch(query, nameOf(item)) }))
    .filter(({ match }) => match.matches)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
