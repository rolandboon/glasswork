import {
  boolean,
  date,
  isoDate,
  literal,
  number,
  picklist,
  pipe,
  string,
  transform,
  union,
} from 'valibot';

/** Parse a numeric/boolean literal from a query string token (no dates). */
export function parseFilterLiteral(value: string): string | number | boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const numValue = Number(value);
  if (!Number.isNaN(numValue) && value.trim() !== '') {
    return numValue;
  }
  return value;
}

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/** Valibot schema for a single Prisma date filter operand (`YYYY-MM-DD` → `Date`). */
export const dateFilterValueSchema = () =>
  pipe(
    union([date(), pipe(string(), isoDate())]),
    transform((value) => toUtcDate(value))
  );

/** Valibot schema for a single Prisma int filter operand. */
export const intFilterValueSchema = () =>
  pipe(
    union([string(), number()]),
    transform((value) => (typeof value === 'number' ? value : Number(value)))
  );

/** Valibot schema for a single Prisma float/int filter operand (legacy string input). */
export const numberFilterValueSchema = () =>
  pipe(
    union([string(), number(), literal(true), literal(false)]),
    transform((value) => {
      if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      return parseFilterLiteral(value);
    })
  );

/** Valibot schema for a single Prisma boolean filter operand. */
export const booleanFilterValueSchema = () =>
  pipe(
    union([boolean(), picklist(['true', 'false'])]),
    transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
  );

/**
 * Valibot schema for comparison operands on paths outside the filter schema (e.g. scope).
 * Parses dates and numeric/boolean literals; leaves other strings unchanged.
 */
export const unknownComparisonValueSchema = () =>
  pipe(
    string(),
    transform((value) => {
      if (ISO_DAY_PATTERN.test(value)) {
        return toUtcDate(value);
      }
      return parseFilterLiteral(value);
    })
  );
