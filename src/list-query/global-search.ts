import type { FieldPath, SearchFieldInput } from './types.js';

/**
 * Normalize a search field input to a FieldPath
 * Converts string to array for consistent internal handling
 */
function normalizeSearchField(field: SearchFieldInput): FieldPath {
  return typeof field === 'string' ? [field] : field;
}

/**
 * Build a nested Prisma where condition for a single field path
 * Used for global search - creates contains condition with case-insensitive mode
 */
function buildSearchConditionForField(
  fieldPath: FieldPath,
  searchTerm: string
): Record<string, unknown> {
  if (fieldPath.length === 1) {
    const field = fieldPath[0];
    if (!field) {
      throw new Error('Field path element cannot be undefined');
    }
    return {
      [field]: {
        contains: searchTerm,
        mode: 'insensitive',
      },
    };
  }
  const [first, ...rest] = fieldPath;
  if (!first) {
    throw new Error('Field path element cannot be undefined');
  }
  return {
    [first]: buildSearchConditionForField(rest as FieldPath, searchTerm),
  };
}

/**
 * Build Prisma where clause for global search across multiple fields
 * Creates OR conditions for each field path
 *
 * @param searchFields - Array of field paths (strings for flat fields, arrays for nested)
 * @param searchTerm - The search term to look for
 * @returns Prisma where clause with OR conditions, or empty object if no search fields or empty term
 *
 * @example
 * ```typescript
 * // Flat fields (simple strings)
 * buildGlobalSearchWhere(['name', 'email'], 'john')
 *
 * // Mixed flat and nested fields
 * buildGlobalSearchWhere(['email', 'firstName', ['organization', 'name']], 'acme')
 * ```
 */
export function buildGlobalSearchWhere(
  searchFields: readonly SearchFieldInput[],
  searchTerm?: string
): Record<string, unknown> {
  if (!searchTerm || searchTerm.trim() === '' || searchFields.length === 0) {
    return {};
  }
  const trimmedTerm = searchTerm.trim();
  const normalizedFields = searchFields.map(normalizeSearchField);
  const orConditions = normalizedFields.map((fieldPath) =>
    buildSearchConditionForField(fieldPath, trimmedTerm)
  );
  if (orConditions.length === 1) {
    const condition = orConditions[0];
    if (!condition) {
      return {};
    }
    return condition;
  }
  return {
    OR: orConditions,
  };
}
