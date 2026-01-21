import { PureAbility } from '@casl/ability';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertCan,
  can,
  createAbilityFactory,
  createAuthMiddleware,
  createBetterAuthProvider,
  defineRoleAbilities,
  subject,
} from '../../src/auth/index.js';
import { defaultErrorHandler } from '../../src/http/error-handler.js';
import { ForbiddenException, UnauthorizedException } from '../../src/http/errors.js';

describe('auth abilities', () => {
  describe('createAbilityFactory', () => {
    it('builds ability with provided rules', () => {
      type AppSubjects = 'Project' | 'all';
      type AppActions = 'read' | 'manage' | 'delete';

      const defineAbility = createAbilityFactory<AppSubjects, AppActions>()(
        (canRule, cannot, user) => {
          if (user.role === 'ADMIN') {
            canRule('manage', 'all');
          } else {
            canRule('read', 'Project', { organizationId: user.tenantId });
            cannot('delete', 'Project');
          }
        }
      );

      const memberAbility = defineAbility({ id: 'user-1', role: 'MEMBER', tenantId: 'org-1' });
      expect(memberAbility.can('read', subject('Project', { organizationId: 'org-1' }))).toBe(true);
      expect(memberAbility.can('delete', 'Project')).toBe(false);

      const adminAbility = defineAbility({ id: 'user-2', role: 'ADMIN' });
      expect(adminAbility.can('manage', 'all')).toBe(true);
    });
  });

  describe('defineRoleAbilities', () => {
    const roles = defineRoleAbilities<'Project', 'read' | 'update', 'ADMIN' | 'MEMBER'>({
      ADMIN: ({ can }) => can('read', 'Project'),
      MEMBER: ({ can, user }) => {
        if (user.tenantId) {
          can('update', 'Project', { organizationId: user.tenantId });
        }
      },
    });

    it('creates abilities per role', () => {
      const memberAbility = roles.forRole('MEMBER', { tenantId: 'org-1' });
      expect(memberAbility.can('update', subject('Project', { organizationId: 'org-1' }))).toBe(
        true
      );
      expect(memberAbility.can('update', subject('Project', { organizationId: 'org-2' }))).toBe(
        false
      );
    });

    it('ensures explicit role parameter takes precedence over user object properties', () => {
      const roles = defineRoleAbilities<'Project', 'read', 'ADMIN' | 'MEMBER'>({
        ADMIN: ({ can }) => can('read', 'Project'),
        MEMBER: () => {},
      });

      const ability = roles.forRole('ADMIN', { role: 'MEMBER' });
      expect(ability.can('read', 'Project')).toBe(true);
    });

    it('falls back to empty rules when role not found', () => {
      const ability = roles.for({ id: 'user', role: 'UNKNOWN' });
      expect(ability.can('read', 'Project')).toBe(false);
    });

    it('throws ForbiddenException when authorized fails', () => {
      const ability = roles.forRole('MEMBER', { tenantId: 'org-1' });
      expect(() => ability.authorize('read', 'Project')).toThrow(ForbiddenException);
    });

    it('allows access when authorized succeeds', () => {
      const ability = roles.forRole('ADMIN');
      expect(() => ability.authorize('read', 'Project')).not.toThrow();
    });
  });

  describe('ability.authorize', () => {
    const defineAbility = createAbilityFactory<'Project', 'manage' | 'read' | 'delete'>()(
      (can, _cannot, user) => {
        if (user.role === 'ADMIN') {
          can('manage', 'Project');
        } else {
          can('read', 'Project');
        }
      }
    );

    it('returns void when authorized', () => {
      const ability = defineAbility({ id: 'u1', role: 'ADMIN' });
      expect(() => ability.authorize('manage', 'Project')).not.toThrow();
    });

    it('throws ForbiddenException when denied', () => {
      const ability = defineAbility({ id: 'u2', role: 'MEMBER' });
      expect(() => ability.authorize('delete', 'Project')).toThrow(ForbiddenException);
    });

    it('throws with custom error message', () => {
      const ability = defineAbility({ id: 'u2', role: 'MEMBER' });
      expect(() => ability.authorize('delete', 'Project', 'Custom forbidden message')).toThrow(
        'Custom forbidden message'
      );
    });

    it('throws default error message', () => {
      const ability = defineAbility({ id: 'u2', role: 'MEMBER' });
      expect(() => ability.authorize('delete', 'Project')).toThrow(
        "You don't have permission to delete this resource"
      );
    });
  });

  describe('assert helpers', () => {
    const ability = new PureAbility([{ action: 'read', subject: 'Project' }]);

    it('assertCan allows permitted actions', () => {
      expect(() => assertCan(ability, 'read', 'Project')).not.toThrow();
    });

    it('assertCan throws ForbiddenException when not permitted', () => {
      expect(() => assertCan(ability, 'delete', 'Project')).toThrow(ForbiddenException);
    });

    it('assertCan throws ForbiddenException with custom message', () => {
      expect(() =>
        assertCan(ability, 'delete', 'Project', {
          forbiddenMessage: 'No access to delete',
        })
      ).toThrow('No access to delete');
    });

    it('assertCan throws UnauthorizedException when not permitted and isAuthenticated is false', () => {
      expect(() => assertCan(ability, 'delete', 'Project', { isAuthenticated: false })).toThrow(
        UnauthorizedException
      );
    });

    it('assertCan throws UnauthorizedException with custom message', () => {
      expect(() =>
        assertCan(ability, 'delete', 'Project', {
          isAuthenticated: false,
          unauthorizedMessage: 'Please log in',
        })
      ).toThrow('Please log in');
    });

    it('assertCan throws UnauthorizedException when ability missing', () => {
      expect(() => assertCan(undefined, 'read', 'Project')).toThrow(UnauthorizedException);
    });

    it('can returns false when ability missing', () => {
      expect(can(undefined, 'read', 'Project')).toBe(false);
      expect(can(ability, 'read', 'Project')).toBe(true);
    });
  });
});

describe('createAuthMiddleware', () => {
  const baseProvider = {
    name: 'mock',
    validateSession: vi.fn(),
    invalidateSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets guest context when no token', async () => {
    baseProvider.validateSession.mockResolvedValue(null);

    // Create a proper ability factory to ensure authorize method exists
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
      guestAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) =>
      c.json({
        user: c.get('user'),
        isAuthenticated: c.get('isAuthenticated'),
        hasAbility: Boolean(c.get('ability')),
      })
    );

    const res = await app.request('/test');
    const body = await res.json();

    expect(body.user).toBeNull();
    expect(body.isAuthenticated).toBe(false);
    expect(body.hasAbility).toBe(true);
    expect(baseProvider.validateSession).not.toHaveBeenCalled();
  });

  it('builds ability when session is valid', async () => {
    const now = new Date();
    baseProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1', expiresAt: now, createdAt: now },
      user: { id: 'user-1', role: 'ADMIN' },
    });

    const defineTestAbility = createAbilityFactory<'Project', 'read'>()((can) => {
      can('read', 'Project');
    });

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: (user) => defineTestAbility(user),
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) =>
      c.json({
        user: c.get('user'),
        canRead: c.get('ability')?.can('read', 'Project'),
      })
    );

    const res = await app.request('/test', {
      headers: { cookie: 'session=test-token' },
    });

    const body = await res.json();
    expect(body.user.id).toBe('user-1');
    expect(body.canRead).toBe(true);
  });

  it('clears invalid cookie and calls callback', async () => {
    baseProvider.validateSession.mockResolvedValue(null);
    const onInvalid = vi.fn();
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
      onInvalidSession: onInvalid,
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { cookie: 'session=stale' },
    });

    expect(onInvalid).toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toContain('session=');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('returns 401 when authorize fails without user', async () => {
    baseProvider.validateSession.mockResolvedValue(null);
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
      allowGuest: false,
    });

    const app = new Hono();
    app.onError(defaultErrorHandler);
    app.use('*', middleware({ action: 'read', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });

  it('returns 403 when ability denies authorization', async () => {
    const now = new Date();
    baseProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1', expiresAt: now, createdAt: now },
      user: { id: 'user-1', role: 'MEMBER' },
    });

    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: (user) => defineEmptyAbility(user),
      allowGuest: false,
    });

    const app = new Hono();
    app.onError(defaultErrorHandler);
    app.use('*', middleware({ action: 'delete', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', { headers: { cookie: 'session=test' } });
    expect(res.status).toBe(403);
  });

  it('handles provider errors during validation', async () => {
    baseProvider.validateSession.mockRejectedValue(new Error('Validation failed'));
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({ user: c.get('user') }));

    const res = await app.request('/test', { headers: { cookie: 'session=token' } });
    const body = await res.json();
    expect(body.user).toBeNull();
  });

  it('returns 401 when guest ability denies authorization', async () => {
    baseProvider.validateSession.mockResolvedValue(null);
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => defineEmptyAbility({ id: 'guest', role: 'GUEST' }),
      allowGuest: true,
    });

    const app = new Hono();
    app.onError(defaultErrorHandler);
    app.use('*', middleware({ action: 'read', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });

  it('extracts token from authorization header', async () => {
    const now = new Date();
    baseProvider.validateSession.mockResolvedValue({
      session: { id: 's1', userId: 'u1', expiresAt: now, createdAt: now },
      user: { id: 'u1', role: 'ADMIN' },
    });

    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});
    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: (user) => defineEmptyAbility(user),
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({ user: c.get('user') }));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const body = await res.json();
    expect(body.user.id).toBe('u1');
    expect(baseProvider.validateSession).toHaveBeenCalledWith('valid-token');
  });

  it('ignores invalid authorization header format', async () => {
    const defineEmptyAbility = createAbilityFactory<string, string>()(() => {});
    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: (user) => defineEmptyAbility(user),
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({ user: c.get('user') }));

    const res = await app.request('/test', {
      headers: { Authorization: 'Basic invalid-token' },
    });
    const body = await res.json();
    expect(body.user).toBeNull();
    expect(baseProvider.validateSession).not.toHaveBeenCalled();
  });
});

describe('createBetterAuthProvider', () => {
  const auth = {
    api: {
      getSession: vi.fn(),
      revokeSession: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps user and session', async () => {
    const now = new Date();
    auth.api.getSession.mockResolvedValue({
      session: {
        id: 'sess-1',
        userId: 'user-1',
        expiresAt: now.toISOString(),
        createdAt: now.toISOString(),
        lastAccessedAt: now.toISOString(),
        token: 'session-token',
      },
      user: {
        id: 'user-1',
        email: 'test@example.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      },
    });

    const provider = createBetterAuthProvider({ auth });
    const result = await provider.validateSession('token');

    expect(auth.api.getSession).toHaveBeenCalledWith({ headers: { cookie: 'session=token' } });
    expect(result?.user.role).toBe('ADMIN');
    expect(result?.session.expiresAt).toBeInstanceOf(Date);
    expect(result?.session.lastAccessedAt).toBeInstanceOf(Date);
  });

  it('converts numeric ID to string', async () => {
    const now = new Date();
    auth.api.getSession.mockResolvedValue({
      session: { id: 's1', userId: 123, expiresAt: now, createdAt: now },
      user: { id: 123, role: 'ADMIN' },
    });

    const provider = createBetterAuthProvider({ auth });
    const result = await provider.validateSession('token');

    expect(result?.user.id).toBe('123');
    expect(typeof result?.user.id).toBe('string');
  });

  it('returns null when session missing', async () => {
    auth.api.getSession.mockResolvedValue(null);
    const provider = createBetterAuthProvider({ auth });

    const result = await provider.validateSession('token');
    expect(result).toBeNull();
  });

  it('supports custom user mapping', async () => {
    const now = new Date();
    auth.api.getSession.mockResolvedValue({
      session: {
        id: 'sess-1',
        userId: 'user-1',
        expiresAt: now,
        createdAt: now,
      },
      user: { identifier: 'custom-id', email: 'custom@example.com' },
    });

    const provider = createBetterAuthProvider({
      auth,
      mapUser: (user) => ({
        id: String(user.identifier),
        role: 'CUSTOM',
        email: user.email as string,
      }),
    });

    const result = await provider.validateSession('token');
    expect(result?.user.role).toBe('CUSTOM');
    expect(result?.user.id).toBe('custom-id');
  });

  it('revokes and refreshes sessions', async () => {
    const now = new Date();
    auth.api.getSession.mockResolvedValue({
      session: {
        id: 'sess-1',
        userId: 'user-1',
        expiresAt: now.toISOString(),
        createdAt: now.toISOString(),
      },
      user: { id: 'user-1', role: 'ADMIN' },
    });

    const provider = createBetterAuthProvider({ auth });

    const refresh = await provider.refreshSession('session-token');
    expect(refresh?.id).toBe('sess-1');

    await provider.invalidateSession('sess-1');
    expect(auth.api.revokeSession).toHaveBeenCalledWith({ body: { id: 'sess-1' } });
  });

  it('returns null when validateSession api call fails', async () => {
    auth.api.getSession.mockRejectedValue(new Error('API Error'));
    const provider = createBetterAuthProvider({ auth });

    const result = await provider.validateSession('token');
    expect(result).toBeNull();
  });

  it('returns null when refreshSession api call fails', async () => {
    auth.api.getSession.mockRejectedValue(new Error('API Error'));
    const provider = createBetterAuthProvider({ auth });

    const result = await provider.refreshSession('session-token');
    expect(result).toBeNull();
  });
});
