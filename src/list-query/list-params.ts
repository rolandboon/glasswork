import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';
import type { ValidatedListParams } from './validator.js';

/**
 * Infer list params from filter and sort Valibot schemas.
 *
 * @example
 * ```typescript
 * type UserListParams = InferListParams<
 *   typeof UserFilterSchema,
 *   typeof UserSortSchema
 * >;
 * ```
 */
export type InferListParams<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> = ValidatedListParams<TWhereSchema, TOrderBySchema>;

/** Single orderBy entry type from list params or a sort schema. */
export type InferOrderByItem<
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> = InferOutput<TOrderBySchema>;
