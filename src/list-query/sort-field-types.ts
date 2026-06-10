export type SortDirection = 'asc' | 'desc';

/**
 * Map a dot-notation sort path to a nested Prisma-style orderBy object type.
 *
 * @example
 * `SortPathToOrderBy<'organization.name'>` → `{ organization: { name?: SortDirection } }`
 */
export type SortPathToOrderBy<Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? { [K in Head]?: SortPathToOrderBy<Tail> }
  : Path extends string
    ? { [K in Path]?: SortDirection }
    : never;

/** Merge a union of orderBy object shapes into one intersection type. */
export type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I
) => void
  ? I
  : never;

/**
 * Infer the Prisma-style orderBy entry type from `createSortSchema` field keys.
 */
export type SortFieldsToOrderBy<T extends Record<string, unknown>> = UnionToIntersection<
  {
    [K in keyof T]: K extends string ? SortPathToOrderBy<K> : never;
  }[keyof T]
>;
