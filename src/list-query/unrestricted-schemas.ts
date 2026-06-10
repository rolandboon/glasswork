import { type BaseIssue, type BaseSchema, lazy, looseObject, record, string, union } from 'valibot';
import { sortDirectionSchema } from './schema-helpers.js';
import type { SortDirection } from './sort-field-types.js';

/**
 * Accepts any where shape produced by the list-query parser, global search, and scopes.
 * Used when a list endpoint has no dedicated filter schema.
 */
export const unrestrictedWhereSchema = looseObject({});

/** Recursive orderBy entry for list endpoints without a dedicated sort schema. */
export type PermissiveOrderBy = {
  readonly [key: string]: SortDirection | PermissiveOrderBy;
};

export const permissiveOrderByEntrySchema: BaseSchema<
  PermissiveOrderBy,
  PermissiveOrderBy,
  BaseIssue<unknown>
> = lazy(() => record(string(), union([sortDirectionSchema(), permissiveOrderByEntrySchema])));
