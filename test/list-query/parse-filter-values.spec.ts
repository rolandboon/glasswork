import { describe, expect, test } from 'vitest';
import {
  parseFilterLiteral,
  parseFilterValue,
  parseWhereFilterValues,
} from '../../src/list-query/parse-filter-values.js';
import {
  booleanFilterSchema,
  createFilterSchema,
  dateFilterSchema,
  intFilterSchema,
  relationFilterSchema,
  stringFilterSchema,
} from '../../src/list-query/schema-helpers.js';

const UserFilterSchema = createFilterSchema({
  referenceCode: stringFilterSchema(),
  active: booleanFilterSchema(),
  age: intFilterSchema(),
  createdAt: dateFilterSchema(),
  day: relationFilterSchema(
    createFilterSchema({
      date: dateFilterSchema(),
    })
  ),
});

describe('parseFilterLiteral', () => {
  test('parses booleans and numbers', () => {
    expect(parseFilterLiteral('true')).toBe(true);
    expect(parseFilterLiteral('false')).toBe(false);
    expect(parseFilterLiteral('42')).toBe(42);
    expect(parseFilterLiteral('3.14')).toBe(3.14);
  });

  test('leaves other strings unchanged', () => {
    expect(parseFilterLiteral('test')).toBe('test');
    expect(parseFilterLiteral('2024-01-01')).toBe('2024-01-01');
  });
});

describe('parseFilterValue', () => {
  test('keeps substring operators as raw strings', () => {
    expect(parseFilterValue('432', '@=')).toBe('432');
    expect(parseFilterValue('a|b', '@=|')).toBe('a|b');
  });

  test('parses equality and comparison operators', () => {
    expect(parseFilterValue('18', '>=')).toBe(18);
    expect(parseFilterValue('true', '==')).toBe(true);
  });
});

describe('parseWhereFilterValues', () => {
  test('parses dateFilterSchema fields', () => {
    const result = parseWhereFilterValues(
      {
        createdAt: { gte: '2026-01-01', lte: '2026-12-31' },
      },
      UserFilterSchema
    );

    const createdAt = result.createdAt as Record<string, unknown>;
    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeInstanceOf(Date);
    expect((createdAt.gte as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('parses equals and not on dateFilterSchema fields', () => {
    const result = parseWhereFilterValues(
      {
        createdAt: {
          equals: '2026-04-14',
          not: '2026-01-01',
        },
      },
      UserFilterSchema
    );

    const filter = result.createdAt as Record<string, unknown>;
    expect(filter.equals).toBeInstanceOf(Date);
    expect(filter.not).toBeInstanceOf(Date);
  });

  test('parses intFilterSchema fields from string scope values', () => {
    const result = parseWhereFilterValues(
      {
        age: { gte: '18', in: ['21', '25'] },
      },
      UserFilterSchema
    );

    const age = result.age as Record<string, unknown>;
    expect(age.gte).toBe(18);
    expect(age.in).toEqual([21, 25]);
  });

  test('parses booleanFilterSchema fields from string scope values', () => {
    const result = parseWhereFilterValues(
      {
        active: { equals: 'true' },
      },
      UserFilterSchema
    );

    expect((result.active as Record<string, unknown>).equals).toBe(true);
  });

  test('does not parse date-like equals on stringFilterSchema fields', () => {
    const result = parseWhereFilterValues(
      {
        referenceCode: { equals: '2024-01-01' },
      },
      UserFilterSchema
    );

    expect((result.referenceCode as Record<string, unknown>).equals).toBe('2024-01-01');
  });

  test('recurses into relationFilterSchema is wrappers', () => {
    const result = parseWhereFilterValues(
      {
        day: { is: { date: { gte: '2026-03-01' } } },
      },
      UserFilterSchema
    );

    const gte = (
      ((result.day as Record<string, unknown>).is as Record<string, unknown>).date as Record<
        string,
        unknown
      >
    ).gte;
    expect(gte).toBeInstanceOf(Date);
  });

  test('parses comparison operators on unknown nested paths', () => {
    const result = parseWhereFilterValues(
      {
        currentStatus: { is: { createdAt: { gte: '2024-01-01' }, score: { gte: '18' } } },
      },
      UserFilterSchema
    );

    const nested = (result.currentStatus as Record<string, unknown>).is as Record<string, unknown>;
    expect((nested.createdAt as Record<string, unknown>).gte).toBeInstanceOf(Date);
    expect((nested.score as Record<string, unknown>).gte).toBe(18);
  });

  test('does not parse equals on unknown nested paths', () => {
    const result = parseWhereFilterValues(
      {
        metadata: { is: { code: { equals: '2024-01-01' } } },
      },
      UserFilterSchema
    );

    const equals = (
      ((result.metadata as Record<string, unknown>).is as Record<string, unknown>).code as Record<
        string,
        unknown
      >
    ).equals;
    expect(equals).toBe('2024-01-01');
  });
});
