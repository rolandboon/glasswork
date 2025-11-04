import { accessibleBy, type Subjects } from '@casl/prisma';
import type { PureAbility } from '@casl/ability';
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
export function createCaslScope<TAbility extends PureAbility<any, any>>(
	ability: TAbility,
	subject: string,
) {
	const conditions = accessibleBy(ability as any)[subject];
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
	return <TAbility extends PureAbility<any, any>>(
		builder: ListQueryBuilder<any, any>,
		ability: TAbility,
	) => {
		return builder.scope(accessibleBy(ability as any)[subject]);
	};
}

