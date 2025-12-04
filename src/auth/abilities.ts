import { AbilityBuilder, type PureAbility } from '@casl/ability';
import { createPrismaAbility, type PrismaQuery } from '@casl/prisma';
import type { AuthUser } from './types.js';

/**
 * Create a type-safe ability factory for your application.
 *
 * @example
 * const defineAbility = createAbilityFactory<AppSubjects>()((can, cannot, user) => {
 *   if (user.role === 'ADMIN') {
 *     can('manage', 'all');
 *   } else {
 *     can('read', 'Project', { organizationId: user.tenantId });
 *   }
 * });
 *
 * const ability = defineAbility(currentUser);
 */
export function createAbilityFactory<
  TSubjects extends string,
  TActions extends string = 'create' | 'read' | 'update' | 'delete' | 'manage',
>() {
  type AppAbility = PureAbility<[TActions, TSubjects], PrismaQuery>;

  return function defineAbility(
    define: (
      can: AbilityBuilder<AppAbility>['can'],
      cannot: AbilityBuilder<AppAbility>['cannot'],
      user: AuthUser
    ) => void
  ) {
    return (user: AuthUser): AppAbility => {
      const { can, cannot, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);
      define(can, cannot, user);
      return build();
    };
  };
}

/**
 * Define abilities using a declarative role-based configuration.
 */
export function defineRoleAbilities<
  TSubjects extends string,
  TActions extends string,
  TRoles extends string,
>(
  config: Record<
    TRoles,
    (ctx: {
      can: AbilityBuilder<PureAbility<[TActions, TSubjects], PrismaQuery>>['can'];
      cannot: AbilityBuilder<PureAbility<[TActions, TSubjects], PrismaQuery>>['cannot'];
      user: AuthUser;
    }) => void
  >
) {
  type AppAbility = PureAbility<[TActions, TSubjects], PrismaQuery>;

  return {
    for(user: AuthUser): AppAbility {
      const { can, cannot, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);
      const roleConfig = config[user.role as TRoles];

      if (roleConfig) {
        roleConfig({ can, cannot, user });
      }

      return build();
    },

    /** Get ability for a specific role (useful for testing). */
    forRole(role: TRoles, user: Partial<AuthUser> = {}): AppAbility {
      return this.for({ id: 'test', role, ...user } as AuthUser);
    },
  };
}

/**
 * Helper type to extract ability type from a factory.
 */
export type InferAbility<T> = T extends (user: AuthUser) => infer A ? A : never;
