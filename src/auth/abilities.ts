import { AbilityBuilder, type ForcedSubject, type PureAbility } from '@casl/ability';
import { createPrismaAbility, type PrismaQuery } from '@casl/prisma';
import { ForbiddenException } from '../http/errors.js';
import type { AuthUser } from './types.js';

/**
 * Extended ability type with authorize method
 */
export interface AuthorizedAbility<TActions extends string, TSubjects extends string>
  extends PureAbility<[TActions, TSubjects | ForcedSubject<TSubjects>], PrismaQuery> {
  authorize: (
    action: TActions,
    subject: TSubjects | ForcedSubject<TSubjects>,
    message?: string
  ) => void;
}

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
  type AppAbility = AuthorizedAbility<TActions, TSubjects>;

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
      const ability = build();

      return Object.assign(ability, {
        authorize(
          action: TActions,
          subject: TSubjects | ForcedSubject<TSubjects>,
          message?: string
        ): void {
          // biome-ignore lint/suspicious/noExplicitAny: CASL's can() accepts partial subjects but TypeScript types are strict
          if (!(ability as any).can(action, subject)) {
            throw new ForbiddenException(
              message ?? `You don't have permission to ${action} this resource`
            );
          }
        },
      }) as AppAbility;
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
      can: AbilityBuilder<
        PureAbility<[TActions, TSubjects | ForcedSubject<TSubjects>], PrismaQuery>
      >['can'];
      cannot: AbilityBuilder<
        PureAbility<[TActions, TSubjects | ForcedSubject<TSubjects>], PrismaQuery>
      >['cannot'];
      user: AuthUser;
    }) => void
  >
) {
  type AppAbility = AuthorizedAbility<TActions, TSubjects>;

  return {
    for(user: AuthUser): AppAbility {
      const { can, cannot, build } = new AbilityBuilder<
        PureAbility<[TActions, TSubjects | ForcedSubject<TSubjects>], PrismaQuery>
      >(createPrismaAbility);

      const roleConfig = config[user.role as TRoles];

      if (roleConfig) {
        roleConfig({ can, cannot, user });
      }

      const ability = build();

      return Object.assign(ability, {
        authorize(
          action: TActions,
          subject: TSubjects | ForcedSubject<TSubjects>,
          message?: string
        ): void {
          // biome-ignore lint/suspicious/noExplicitAny: CASL's can() accepts partial subjects but TypeScript types are strict
          if (!(ability as any).can(action, subject)) {
            throw new ForbiddenException(
              message ?? `You don't have permission to ${action} this resource`
            );
          }
        },
      }) as AppAbility;
    },

    /** Get ability for a specific role (useful for testing). */
    forRole(role: TRoles, user: Partial<AuthUser> = {}): AppAbility {
      return this.for({ id: 'test', ...user, role } as AuthUser);
    },
  };
}

/**
 * Helper type to extract ability type from a factory.
 */
export type InferAbility<T> = T extends (user: AuthUser) => infer A ? A : never;
