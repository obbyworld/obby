const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  middot: "\u00b7",
  bull: "\u2022",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  times: "\u00d7",
  deg: "\u00b0",
  euro: "\u20ac",
  pound: "\u00a3",
};

// We decode in one pass so "&amp;quot;" stays the literal text "&quot;".
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex ?? "", 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    },
  );
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
