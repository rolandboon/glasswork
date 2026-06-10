import { type Context, Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
  });

  describe('Authorization', () => {
    it('should allow access when authorize check passes', async () => {
      const app = new Hono();
      const ability = { can: vi.fn().mockReturnValue(true) };

      app.get(
        '/authorized',
        ...route(router, {
          summary: 'Authorized route',
          authorize: { action: 'read', subject: 'Project' },
          responses: { 200: v.object({ ok: v.boolean() }) },
          handler: async () => ({ ok: true }),
        })
      );

      await app.request('/authorized', {
        headers: { cookie: 'session=token' },
      });

      // We need to set the ability on the context since route() reads it
      // Mocking the context passed to enforceRouteAuthorization
      const middlewares = route(router, {
        authorize: { action: 'read', subject: 'Project' },
        handler: async () => ({ ok: true }),
      });
      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          valid: vi.fn().mockImplementation((target) => (target === 'json' ? {} : {})),
          header: vi.fn(),
        },
        get: vi.fn().mockImplementation((key) => {
          if (key === 'ability') return ability;
          if (key === 'isAuthenticated') return true;
          return {};
        }),
        var: { isAuthenticated: true, ability }, // buildRouteContext uses c.var
        json: vi.fn(),
      };

      await handlerMiddleware(mockContext as unknown as Context, vi.fn());
      expect(ability.can).toHaveBeenCalledWith('read', 'Project');
    });

    it('should throw ForbiddenException when ability.can returns false', async () => {
      const ability = { can: vi.fn().mockReturnValue(false) };
      const middlewares = route(router, {
        authorize: { action: 'delete', subject: 'Project' },
        handler: async () => ({ ok: true }),
      });
      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          valid: vi.fn().mockImplementation(() => ({})),
          header: vi.fn(),
        },
        get: vi.fn().mockImplementation((key) => {
          if (key === 'ability') return ability;
          if (key === 'isAuthenticated') return true;
          return {};
        }),
        var: { isAuthenticated: true, ability },
      };

      await expect(handlerMiddleware(mockContext as unknown as Context, vi.fn())).rejects.toThrow(
        "You don't have permission to delete Project"
      );
    });

    it('should throw UnauthorizedException when not authenticated and guests not allowed', async () => {
      const middlewares = route(router, {
        authorize: { action: 'read', subject: 'Project', allowGuest: false },
        handler: async () => ({ ok: true }),
      });
      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          valid: vi.fn().mockImplementation(() => ({})),
          header: vi.fn(),
        },
        get: vi.fn().mockReturnValue(false), // isAuthenticated: false
        var: { isAuthenticated: false },
      };

      await expect(handlerMiddleware(mockContext as unknown as Context, vi.fn())).rejects.toThrow(
        'Authentication required'
      );
    });

    it('should allow guest access when allowGuest is true', async () => {
      const ability = { can: vi.fn().mockReturnValue(true) };
      const middlewares = route(router, {
        authorize: { action: 'read', subject: 'Project', allowGuest: true },
        handler: async () => ({ ok: true }),
      });
      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          valid: vi.fn().mockImplementation(() => ({})),
          header: vi.fn(),
        },
        get: vi.fn().mockReturnValue(false), // isAuthenticated: false
        var: { isAuthenticated: false, ability },
        json: vi.fn(),
      };

      await handlerMiddleware(mockContext as unknown as Context, vi.fn());
      expect(ability.can).toHaveBeenCalledWith('read', 'Project');
    });

    it('should throw UnauthorizedException when guest is denied permission', async () => {
      const ability = { can: vi.fn().mockReturnValue(false) };
      const middlewares = route(router, {
        authorize: { action: 'read', subject: 'Project', allowGuest: true },
        handler: async () => ({ ok: true }),
      });
      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          valid: vi.fn().mockImplementation(() => ({})),
          header: vi.fn(),
        },
        get: vi.fn().mockReturnValue(false),
        var: { isAuthenticated: false, ability },
      };

      await expect(handlerMiddleware(mockContext as unknown as Context, vi.fn())).rejects.toThrow(
        'Authentication required'
      );
    });
  });
});
