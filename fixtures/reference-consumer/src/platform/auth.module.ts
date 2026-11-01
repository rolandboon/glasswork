import { createPrismaAbility } from '@casl/prisma';
import {
  type AuthProvider,
  type AuthUser,
  createAbilityFactory,
  createAuthMiddleware,
  registerAuthCasl,
} from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import type { MiddlewareHandler } from 'hono';

registerAuthCasl({ createPrismaAbility });

/** The shape `createAuthMiddleware` returns, without its ability-specific types. */
export type AuthMiddlewareFactory = () => MiddlewareHandler;

export interface AppUser extends AuthUser {
  tenantId: string;
}

/** Fixed tokens keep the fixture independent of an identity provider. */
const users: Record<string, AppUser> = {
  'alice-token': { id: 'alice', role: 'member', tenantId: 'tenant-a' },
  'bob-token': { id: 'bob', role: 'member', tenantId: 'tenant-b' },
};

export const tokenProvider: AuthProvider<AppUser> = {
  name: 'tokens',
  async validateSession(token) {
    const user = users[token];
    if (!user) return null;
    const now = new Date();
    return {
      user,
      session: {
        id: `session-${user.id}`,
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
    };
  },
  async invalidateSession() {},
};

export const abilityFor = createAbilityFactory<
  'Project' | 'Invitation' | 'Order',
  'read' | 'create'
>()((can) => {
  can('read', 'Project');
  can('create', 'Project');
  can('create', 'Invitation');
  can('create', 'Order');
});

export const AuthModule = defineModule({
  name: 'auth',
  providers: [
    {
      provide: 'requireAuth',
      useValue: createAuthMiddleware({
        provider: tokenProvider,
        buildAbility: abilityFor,
        allowGuest: false,
      }),
    },
    {
      provide: 'optionalAuth',
      useValue: createAuthMiddleware({ provider: tokenProvider, buildAbility: abilityFor }),
    },
  ],
  exports: ['requireAuth', 'optionalAuth'],
});
