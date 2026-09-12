function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

export type FilterMapper<TFilter = unknown> = (
  filter: TFilter
) => Record<string, unknown> | undefined;

export type FilterMappings = Record<string, FilterMapper<unknown>>;

function mapLogicalConditions(value: unknown, mappings: FilterMappings): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (isPlainObject(item) ? applyFilterMappings(item, mappings) : item));
  }
  if (isPlainObject(value)) {
    return applyFilterMappings(value, mappings);
  }
  return value;
}

/**
 * Recursively maps virtual/composite filter fields in a list query `where` clause
 * to actual database fields/conditions.
 */
export function applyFilterMappings(
  where: Record<string, unknown>,
  mappings: FilterMappings
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      result[key] = mapLogicalConditions(value, mappings);
      continue;
    }

    const mapper = mappings[key];
    if (mapper) {
      const mapped = mapper(value);
      if (mapped !== undefined) {
        Object.assign(result, mapped);
      }
    } else if (isPlainObject(value)) {
      result[key] = applyFilterMappings(value, mappings);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export interface PresenceFilterOptions {
  /**
   * Which boolean value indicates that the field must be present (NOT NULL).
   * @default true
   */
  readonly presentWhen?: boolean;
}

function extractBooleanCondition(filter: unknown): boolean | undefined {
  if (typeof filter === 'boolean') {
    return filter;
  }
  if (!filter || typeof filter !== 'object') {
    return undefined;
  }
  const { equals, not } = filter as { equals?: unknown; not?: unknown };
  if (typeof equals === 'boolean') {
    return equals;
  }
  if (typeof not === 'boolean') {
    return !not;
  }
  return undefined;
}

/**
 * Maps a boolean virtual filter to a nullability condition on a target database column.
 *
 * @example
 * ```ts
 * // archived: true -> { archivedAt: { not: null } }
 * // archived: false -> { archivedAt: null }
 * archived: mapPresenceFilter('archivedAt')
 *
 * // active: true -> { archivedAt: null }
 * // active: false -> { archivedAt: { not: null } }
 * active: mapPresenceFilter('archivedAt', { presentWhen: false })
 * ```
 */
export function mapPresenceFilter(
  targetField: string,
  options?: PresenceFilterOptions
): FilterMapper<unknown> {
  const presentWhen = options?.presentWhen ?? true;

  return (filter: unknown) => {
    const bool = extractBooleanCondition(filter);
    if (bool === undefined) {
      return undefined;
    }

    const isPresent = bool === presentWhen;
    return {
      [targetField]: isPresent ? { not: null } : null,
    };
  };
}

export interface BooleanFilterMapping<TTrue = unknown, TFalse = unknown> {
  readonly whenTrue: TTrue;
  readonly whenFalse: TFalse;
}

/**
 * Maps a boolean virtual filter to custom target values or conditions.
 *
 * @example
 * ```ts
 * // active: true -> { status: 'ACTIVE' }
 * // active: false -> { status: 'INACTIVE' }
 * active: mapBooleanFilter('status', {
 *   whenTrue: 'ACTIVE',
 *   whenFalse: 'INACTIVE',
 * })
 * ```
 */
export function mapBooleanFilter<TTrue = unknown, TFalse = unknown>(
  targetField: string,
  mapping: BooleanFilterMapping<TTrue, TFalse>
): FilterMapper<unknown> {
  return (filter: unknown) => {
    const bool = extractBooleanCondition(filter);
    if (bool === undefined) {
      return undefined;
    }

    const targetValue = bool ? mapping.whenTrue : mapping.whenFalse;
    return {
      [targetField]: targetValue,
    };
  };
}

/**
 * Translates filter values (literals, equals, not, in, notIn) using a dictionary mapping.
 *
 * @example
 * ```ts
 * // status: 'published' -> { status: 'PUBLISHED' }
 * // status: { in: ['draft', 'published'] } -> { status: { in: ['DRAFT', 'PUBLISHED'] } }
 * status: mapValueFilter('status', {
 *   draft: 'DRAFT',
 *   published: 'PUBLISHED',
 *   archived: 'ARCHIVED',
 * })
 * ```
 */
function mapValueOperator(op: string, val: unknown, mapSingle: (v: unknown) => unknown): unknown {
  if (op === 'equals' || op === 'not') {
    return mapSingle(val);
  }
  if ((op === 'in' || op === 'notIn') && Array.isArray(val)) {
    return val.map(mapSingle);
  }
  return val;
}

function mapValueFilterObject(
  filter: Record<string, unknown>,
  mapSingle: (v: unknown) => unknown
): Record<string, unknown> | undefined {
  if (Object.keys(filter).length === 0) {
    return undefined;
  }
  const transformed: Record<string, unknown> = {};
  for (const [op, val] of Object.entries(filter)) {
    transformed[op] = mapValueOperator(op, val, mapSingle);
  }
  return transformed;
}

export function mapValueFilter<TSource extends string | number = string, TTarget = unknown>(
  targetField: string,
  valueMap: Readonly<Record<TSource, TTarget>>
): FilterMapper<unknown> {
  const mapSingle = (val: unknown): unknown => {
    if (typeof val === 'string' || typeof val === 'number') {
      const key = val as TSource;
      if (Object.hasOwn(valueMap, key)) {
        return valueMap[key];
      }
    }
    return val;
  };

  return (filter: unknown) => {
    if (filter === undefined || filter === null) {
      return undefined;
    }

    if (typeof filter === 'string' || typeof filter === 'number') {
      return { [targetField]: mapSingle(filter) };
    }

    if (isPlainObject(filter)) {
      const transformed = mapValueFilterObject(filter, mapSingle);
      return transformed ? { [targetField]: transformed } : undefined;
    }

    return undefined;
  };
}

/**
 * Renames a filter parameter to match a different database column or field name.
 *
 * @example
 * ```ts
 * // userEmail: { contains: 'alice' } -> { email: { contains: 'alice' } }
 * userEmail: renameFilter('email')
 * ```
 */
export function renameFilter(targetField: string): FilterMapper<unknown> {
  return (filter: unknown) => {
    if (filter === undefined) {
      return undefined;
    }
    return { [targetField]: filter };
  };
}

/**
 * Nests a filter under one or more relational path segments.
 * Optionally applies an inner filter mapper before nesting.
 *
 * @example
 * ```ts
 * // authorEmail: { contains: 'alice' } -> { author: { email: { contains: 'alice' } } }
 * authorEmail: nestFilter('author.email')
 *
 * // with array path:
 * authorEmail: nestFilter(['author', 'email'])
 *
 * // with inner mapper:
 * authorArchived: nestFilter('author', mapPresenceFilter('archivedAt'))
 * ```
 */
export function nestFilter(
  path: string | readonly string[],
  innerMapper?: FilterMapper<unknown>
): FilterMapper<unknown> {
  const segments = Array.isArray(path) ? path : (path as string).split('.').filter(Boolean);

  if (segments.length === 0) {
    throw new Error('nestFilter requires at least one path segment');
  }

  return (filter: unknown) => {
    if (filter === undefined) {
      return undefined;
    }

    let payload: unknown;
    if (innerMapper) {
      const mapped = innerMapper(filter);
      if (mapped === undefined) {
        return undefined;
      }
      payload = mapped;
    } else {
      payload = filter;
    }

    let current: unknown = payload;
    for (let i = segments.length - 1; i >= 0; i--) {
      current = { [segments[i]]: current };
    }

    return current as Record<string, unknown>;
  };
}

/**
 * Composes multiple filter mappers for a single filter key, merging their object outputs.
 *
 * @example
 * ```ts
 * // Maps active: true to { isBlocked: false, isVerified: true }
 * active: composeFilterMappers(
 *   mapBooleanFilter('isBlocked', { whenTrue: false, whenFalse: true }),
 *   mapBooleanFilter('isVerified', { whenTrue: true, whenFalse: false }),
 * )
 * ```
 */
export function composeFilterMappers(
  ...mappers: readonly FilterMapper<unknown>[]
): FilterMapper<unknown> {
  return (filter: unknown) => {
    const combined: Record<string, unknown> = {};
    let hasAny = false;

    for (const mapper of mappers) {
      const res = mapper(filter);
      if (res !== undefined) {
        Object.assign(combined, res);
        hasAny = true;
      }
    }

    return hasAny ? combined : undefined;
  };
}
