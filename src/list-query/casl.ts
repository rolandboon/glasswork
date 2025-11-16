import type { PureAbility } from '@casl/ability';
import { accessibleBy } from '@casl/prisma';
import type { ListQueryBuilder } from './builder.js';

/**
 * Create a CASL scope function that can be applied to a ListQueryBuilder
 *
 * @param ability - The CASL ability instance
 * @param subject - The Prisma model name (e.g., 'User', 'Organization')
 * @returns A function that applies the CASL conditions to a builder
 *
 * @example
 * ```typescript
 * const scope = createCaslScope(ability, 'User');
 * const params = createListQuery({ filter: UserFilterSchema })
 *   .parse(query)
 *   .apply(scope)
 *   .build();
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: PureAbility requires two type parameters for full flexibility. Using 'any' here allows this function to accept any CASL ability regardless of its action/subject types.
export function createCaslScope<TAbility extends PureAbility<any, any>>(
  ability: TAbility,
  subject: string
) {
  // biome-ignore lint/suspicious/noExplicitAny: CASL's accessibleBy function has type constraints that don't perfectly align with generic PureAbility types. This cast is necessary for runtime compatibility.
  const conditions = accessibleBy(ability as any)[subject];
  // biome-ignore lint/suspicious/noExplicitAny: Return type must be generic to work with any ListQueryBuilder regardless of its schema types. This maintains maximum flexibility for consumers.
  return (builder: ListQueryBuilder<any, any>) => builder.scope(conditions);
}

/**
 * Create a CASL scope helper that extracts ability from context
 *
 * @param subject - The Prisma model name (e.g., 'User', 'Organization')
 * @returns A function that takes a builder and ability, and applies the CASL conditions
 *
 * @example
 * ```typescript
 * const scopeUsers = withCaslScope('User');
 * const params = createListQuery({ filter: UserFilterSchema })
 *   .parse(query)
 *   .apply(scopeUsers, ability)
 *   .build();
 * ```
 */
export function withCaslScope(subject: string) {
  return <
    // biome-ignore lint/suspicious/noExplicitAny: PureAbility requires two type parameters for full flexibility. Using 'any' here allows this function to accept any CASL ability regardless of its action/subject types.
    TAbility extends PureAbility<any, any>,
  >(
    // biome-ignore lint/suspicious/noExplicitAny: ListQueryBuilder must be generic to work with any schema types. This maintains maximum flexibility for consumers.
    builder: ListQueryBuilder<any, any>,
    ability: TAbility
  ) => {
    // biome-ignore lint/suspicious/noExplicitAny: CASL's accessibleBy function has type constraints that don't perfectly align with generic PureAbility types. This cast is necessary for runtime compatibility.
    return builder.scope(accessibleBy(ability as any)[subject]);
  };
}
