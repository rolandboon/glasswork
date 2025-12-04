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

    it('falls back to empty rules when role not found', () => {
      const ability = roles.for({ id: 'user', role: 'UNKNOWN' });
      expect(ability.can('read', 'Project')).toBe(false);
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

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => new PureAbility([]),
      guestAbility: () => new PureAbility([]),
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

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => new PureAbility([{ action: 'read', subject: 'Project' }]),
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
      headers: { Cookie: 'session=test-token' },
    });

    const body = await res.json();
    expect(body.user.id).toBe('user-1');
    expect(body.canRead).toBe(true);
  });

  it('clears invalid cookie and calls callback', async () => {
    baseProvider.validateSession.mockResolvedValue(null);
    const onInvalid = vi.fn();

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => new PureAbility([]),
      onInvalidSession: onInvalid,
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Cookie: 'session=stale' },
    });

    expect(onInvalid).toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toContain('session=');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('returns 401 when authorize fails without user', async () => {
    baseProvider.validateSession.mockResolvedValue(null);

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => new PureAbility([]),
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

    const middleware = createAuthMiddleware({
      provider: baseProvider,
      buildAbility: () => new PureAbility([]),
      allowGuest: false,
    });

    const app = new Hono();
    app.onError(defaultErrorHandler);
    app.use('*', middleware({ action: 'delete', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', { headers: { Cookie: 'session=test' } });
    expect(res.status).toBe(403);
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

    const refresh = await provider.refreshSession('sess-1');
    expect(refresh?.id).toBe('sess-1');

    await provider.invalidateSession('sess-1');
    expect(auth.api.revokeSession).toHaveBeenCalledWith({ body: { id: 'sess-1' } });
  });
});
