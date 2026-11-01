import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

/** One difference between the saved contract and the generated document. */
export interface OpenAPIDifference {
  /** `added` and `removed` are relative to the saved contract. */
  kind: 'added' | 'removed' | 'changed';
  /** JSON Pointer of the value, such as `/paths/~1api~1projects/get/responses/200`. */
  pointer: string;
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const MAX_LISTED = 20;

export class OpenAPIDriftError extends Error {
  readonly differences: OpenAPIDifference[];

  constructor(filePath: string, differences: OpenAPIDifference[] = []) {
    super(formatDrift(filePath, differences));
    this.name = 'OpenAPIDriftError';
    this.differences = differences;
  }
}

/**
 * Compares JSON documents without changing the committed contract file. On a mismatch the
 * error lists the changed operations and schemas.
 */
export async function assertOpenAPIMatches(document: unknown, filePath: string): Promise<void> {
  const expected: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  // Normalize to JSON so omitted undefined properties match the written artifact.
  const actual: unknown = JSON.parse(JSON.stringify(document));
  if (!isDeepStrictEqual(expected, actual)) {
    throw new OpenAPIDriftError(filePath, diffOpenAPI(expected, actual));
  }
}

/** Writes a document in the form `assertOpenAPIMatches()` reads: indented JSON. */
export async function writeOpenAPIDocument(document: unknown, filePath: string): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

/** Lists where two JSON documents differ, at the deepest object key that differs. */
export function diffOpenAPI(expected: unknown, actual: unknown): OpenAPIDifference[] {
  const differences: OpenAPIDifference[] = [];
  collect(expected, actual, '', differences);
  return differences;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collect(
  expected: unknown,
  actual: unknown,
  pointer: string,
  differences: OpenAPIDifference[]
): void {
  if (isDeepStrictEqual(expected, actual)) return;
  if (!isObject(expected) || !isObject(actual)) {
    differences.push({ kind: 'changed', pointer });
    return;
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const child = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (!(key in actual)) differences.push({ kind: 'removed', pointer: child });
    else if (!(key in expected)) differences.push({ kind: 'added', pointer: child });
    else collect(expected[key], actual[key], child, differences);
  }
}

function unescapePointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** `GET /api/projects` or `schema ProjectDto` for a pointer, with the rest of the pointer. */
function describe(pointer: string): { subject: string; detail: string } {
  const tokens = pointer.split('/').slice(1);
  if (tokens[0] === 'paths' && tokens[1] !== undefined) {
    const path = unescapePointerToken(tokens[1]);
    if (tokens[2] !== undefined && HTTP_METHODS.has(tokens[2])) {
      return { subject: `${tokens[2].toUpperCase()} ${path}`, detail: tokens.slice(3).join('/') };
    }
    return { subject: path, detail: tokens.slice(2).join('/') };
  }
  if (tokens[0] === 'components' && tokens[1] === 'schemas' && tokens[2] !== undefined) {
    return {
      subject: `schema ${unescapePointerToken(tokens[2])}`,
      detail: tokens.slice(3).join('/'),
    };
  }
  return { subject: pointer || '(document)', detail: '' };
}

function formatDrift(filePath: string, differences: OpenAPIDifference[]): string {
  const symbol = { added: '+', removed: '-', changed: '~' } as const;
  const lines = differences.slice(0, MAX_LISTED).map(({ kind, pointer }) => {
    const { subject, detail } = describe(pointer);
    const kindOfWhole = detail === '' ? kind : 'changed';
    return `  ${symbol[kindOfWhole]} ${subject}${detail ? `: ${detail} ${kind}` : ''}`;
  });
  if (differences.length > MAX_LISTED) {
    lines.push(`  … and ${differences.length - MAX_LISTED} more`);
  }
  return [
    `OpenAPI contract drift in ${filePath}${lines.length ? ':' : ''}`,
    ...lines,
    `Regenerate and commit ${filePath} if the change is intended.`,
  ].join('\n');
}
