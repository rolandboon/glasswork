export type SortDirection = 'asc' | 'desc';

export type SortMapper = (direction: SortDirection) => Record<string, unknown>;

export type SortMapping = string | SortMapper;

export type SortMappings = Record<string, SortMapping>;

/**
 * Builds a nested Prisma orderBy object from a dot-delimited path and direction.
 *
 * @example
 * ```ts
 * buildNestedSort(['user', 'name'], 'asc')
 * // => { user: { name: 'asc' } }
 * ```
 */
function buildNestedSort(
  parts: readonly string[],
  direction: SortDirection
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let current = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    const next: Record<string, unknown> = {};
    current[part] = next;
    current = next;
  }

  const last = parts[parts.length - 1];
  if (last) {
    current[last] = direction;
  }

  return result;
}

/**
 * Creates a sort mapper that maps a sort field to a nested relational path.
 *
 * @example
 * ```ts
 * mapSorts: {
 *   name: nestSort('user.name'),
 * }
 * ```
 */
export function nestSort(path: string): SortMapper {
  const parts = path.split('.');
  return (direction: SortDirection) => buildNestedSort(parts, direction);
}

/**
 * Creates a sort mapper that renames a public sort field to another column.
 *
 * @example
 * ```ts
 * mapSorts: {
 *   displayName: renameSort('name'),
 * }
 * ```
 */
export function renameSort(targetField: string): SortMapper {
  return (direction: SortDirection) => ({ [targetField]: direction });
}

function resolveMapping(mapping: SortMapping, direction: SortDirection): Record<string, unknown> {
  if (typeof mapping === 'function') {
    return mapping(direction);
  }
  return nestSort(mapping)(direction);
}

function mapSortEntry(
  entry: Record<string, unknown>,
  mappings: SortMappings
): Record<string, unknown> {
  const mappedEntry: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    const mapping = mappings[key];
    if (mapping && (value === 'asc' || value === 'desc')) {
      Object.assign(mappedEntry, resolveMapping(mapping, value));
    } else {
      mappedEntry[key] = value;
    }
  }

  return mappedEntry;
}

/**
 * Applies sort mappings to an array of Prisma orderBy clauses.
 *
 * @example
 * ```ts
 * applySortMappings([{ name: 'asc' }], { name: 'user.name' })
 * // => [{ user: { name: 'asc' } }]
 * ```
 */
export function applySortMappings(
  orderBy: readonly Record<string, unknown>[],
  mappings: SortMappings
): Record<string, unknown>[] {
  if (!orderBy || orderBy.length === 0) {
    return [];
  }

  return orderBy.map((entry) => mapSortEntry(entry, mappings));
}
