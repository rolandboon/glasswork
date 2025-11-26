import type { ListQueryBuilder } from './builder.js';

/**
 * Dynamically import @casl/prisma to keep it as a truly optional dependency.
 * Only loaded when CASL scope functions are actually used.
 */
async function getAccessibleBy() {
  try {
    const { accessibleBy } = await import('@casl/prisma');
    return accessibleBy;
  } catch {
    throw new Error(
      '@casl/prisma package not found. Install with: npm install @casl/ability @casl/prisma\n' +
        'Note: @casl/ability is required as a peer dependency of @casl/prisma.'
    );
  }
}

/**
 * Create a CASL scope function that can be applied to a ListQueryBuilder
 *
 * @param ability - The CASL ability instance (any object that works with @casl/prisma's accessibleBy)
 * @param subject - The Prisma model name (e.g., 'User', 'Organization')
 * @returns A function that applies the CASL conditions to a builder
 *
 * @example
 * ```typescript
 * import { PureAbility } from '@casl/ability';
 * const scope = await createCaslScope(ability, 'User');
 * const params = createListQuery({ filter: UserFilterSchema })
 *   .parse(query)
 *   .apply(scope)
 *   .build();
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Ability type is generic to work with any CASL ability instance. The actual type checking happens at runtime when accessibleBy is called.
export async function createCaslScope<TAbility = any>(ability: TAbility, subject: string) {
  const accessibleBy = await getAccessibleBy();
  // biome-ignore lint/suspicious/noExplicitAny: CASL's accessibleBy function has type constraints that don't perfectly align with generic ability types. This cast is necessary for runtime compatibility.
  const conditions = accessibleBy(ability as any)[subject];
  // biome-ignore lint/suspicious/noExplicitAny: Return type must be generic to work with any ListQueryBuilder regardless of its schema types. This maintains maximum flexibility for consumers.
  return (builder: ListQueryBuilder<any, any>) => builder.scope(conditions);
}

/**
 * Create a CASL scope helper that extracts ability from context
 *
 * @param subject - The Prisma model name (e.g., 'User', 'Organization')
 * @returns An async function that takes a builder and ability, and applies the CASL conditions
 *
 * @example
 * ```typescript
 * import { PureAbility } from '@casl/ability';
 * const scopeUsers = withCaslScope('User');
 * const params = await createListQuery({ filter: UserFilterSchema })
 *   .parse(query)
 *   .applyAsync(scopeUsers, ability)
 *   .build();
 * ```
 */
export function withCaslScope(subject: string) {
  // biome-ignore lint/suspicious/noExplicitAny: Ability type is generic to work with any CASL ability instance. The actual type checking happens at runtime when accessibleBy is called.
  return async <TAbility = any>(
    // biome-ignore lint/suspicious/noExplicitAny: ListQueryBuilder must be generic to work with any schema types. This maintains maximum flexibility for consumers.
    builder: ListQueryBuilder<any, any>,
    ability: TAbility
  ) => {
    const accessibleBy = await getAccessibleBy();
    // biome-ignore lint/suspicious/noExplicitAny: CASL's accessibleBy function has type constraints that don't perfectly align with generic ability types. This cast is necessary for runtime compatibility.
    return builder.scope(accessibleBy(ability as any)[subject]);
  };
}
