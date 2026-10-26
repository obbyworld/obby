export interface SearchableEmoji {
  short_names: string[];
  // Lowercase, with words joined by "_" like the short names.
  keywords?: string[];
}

const EXACT = 0;
const NAME_PREFIX = 1;
const NAME_WORD = 2;
const KEYWORD_WORD = 3;
const NAME_SUBSTRING = 4;

const startsAWord = (phrase: string, needle: string) =>
  `_${phrase}`.includes(`_${needle}`);

function matchTier(emoji: SearchableEmoji, needle: string): number | null {
  const names = emoji.short_names.map((n) => n.toLowerCase());
  if (names.includes(needle)) return EXACT;
  if (names.some((n) => n.startsWith(needle))) return NAME_PREFIX;
  if (names.some((n) => startsAWord(n, needle))) return NAME_WORD;
  if (emoji.keywords?.some((k) => startsAWord(k, needle))) return KEYWORD_WORD;
  if (names.some((n) => n.includes(needle))) return NAME_SUBSTRING;
  return null;
}

export function rankEmojis<T extends SearchableEmoji>(
  emojis: readonly T[],
  query: string,
  limit: number,
): T[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  return emojis
    .flatMap((emoji, index) => {
      const tier = matchTier(emoji, needle);
      return tier === null ? [] : [{ emoji, tier, index }];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.emoji.short_names[0].length - b.emoji.short_names[0].length ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ emoji }) => emoji);
}
