const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: String.fromCharCode(0xa0),
  quot: '"',
};

/**
 * Decodes the HTML entities that appear in compiled MJML text: the named entities for
 * markup characters and numeric references. One pass, so `&amp;lt;` becomes `&lt;`.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    const code = /^#x/i.test(entity)
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
