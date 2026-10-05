import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

export class OpenAPIDriftError extends Error {
  constructor(filePath: string) {
    super(`OpenAPI contract drift: regenerate and commit ${filePath}`);
    this.name = 'OpenAPIDriftError';
  }
}

/** Compares JSON documents without changing the committed contract file. */
export async function assertOpenAPIMatches(document: unknown, filePath: string): Promise<void> {
  const expected: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  // Normalize to JSON so omitted undefined properties match the written artifact.
  const actual: unknown = JSON.parse(JSON.stringify(document));
  if (!isDeepStrictEqual(expected, actual)) {
    throw new OpenAPIDriftError(filePath);
  }
}
