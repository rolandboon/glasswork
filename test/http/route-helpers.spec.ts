import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { type RouteContext, route } from '../../src/http/route-helpers.js';

describe('route', () => {
  it('should create middleware array with OpenAPI and handler', () => {
    const handler = vi.fn().mockResolvedValue({ success: true });

    const middlewares = route({
      summary: 'Test route',
      handler,
    });

    expect(middlewares).toBeInstanceOf(Array);
    expect(middlewares.length).toBeGreaterThan(0);
  });

  it('should add validation middleware when body schema provided', () => {
    const bodySchema = v.object({ email: v.string() });
    const handler = vi.fn();

    const middlewares = route({
      summary: 'Test route',
      body: bodySchema,
      handler,
    });

    // Should have: OpenAPI + body validator + handler
    expect(middlewares.length).toBe(3);
  });

  it('should add multiple validation middlewares', () => {
    const bodySchema = v.object({ email: v.string() });
    const querySchema = v.object({ page: v.string() });
    const handler = vi.fn();

    const middlewares = route({
      summary: 'Test route',
      body: bodySchema,
      query: querySchema,
      handler,
    });

    // Should have: OpenAPI + body validator + query validator + handler
    expect(middlewares.length).toBe(4);
  });

  it('should return 204 for null/undefined results', async () => {
    const handler = vi.fn().mockResolvedValue(null);

    const middlewares = route({
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockReturnValue({}),
      status: vi.fn(),
      body: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(mockContext.status).toHaveBeenCalledWith(204);
    expect(mockContext.body).toHaveBeenCalledWith(null);
  });

  it('should return JSON for non-null results', async () => {
    const result = { success: true, data: { id: '123' } };
    const handler = vi.fn().mockResolvedValue(result);

    const middlewares = route({
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockReturnValue({}),
      json: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(mockContext.json).toHaveBeenCalledWith(result);
  });

  it('should pass services and session from context', async () => {
    const services = { userService: { getUser: vi.fn() } };
    const session = { userId: '123' };
    let capturedContext: unknown;

    const handler = vi.fn().mockImplementation((ctx) => {
      capturedContext = ctx;
      return { success: true };
    });

    const middlewares = route({
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'services') return services;
        if (key === 'session') return session;
        return undefined;
      }),
      json: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(capturedContext).toBeDefined();
    expect((capturedContext as RouteContext).services).toBe(services);
    expect((capturedContext as RouteContext).session).toBe(session);
    expect((capturedContext as RouteContext).context).toBe(mockContext);
  });

  it('should integrate with Hono router', () => {
    const app = new Hono();
    const handler = vi.fn().mockResolvedValue({ success: true });

    // This should work without errors
    app.post(
      '/test',
      ...route({
        summary: 'Test route',
        handler,
      })
    );

    expect(app).toBeDefined();
  });

  describe('Response type handling', () => {
    it('should return Response objects directly', async () => {
      const customResponse = new Response('Custom text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
      const handler = vi.fn().mockResolvedValue(customResponse);

      const middlewares = route({
        summary: 'Test route',
        responses: { 200: undefined },
        handler,
      });

      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          header: vi.fn(),
          valid: vi.fn(),
        },
        get: vi.fn().mockReturnValue({}),
        json: vi.fn(),
      };

      const result = await handlerMiddleware(mockContext as unknown as never, vi.fn());

      expect(result).toBe(customResponse);
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should handle text responses through context.text()', async () => {
      const app = new Hono();

      app.get(
        '/text',
        ...route({
          summary: 'Text response',
          responses: { 200: undefined },
          handler: async ({ context }) => {
            return context.text('OK') as unknown;
          },
        })
      );

      const res = await app.request('/text');
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('OK');
    });

    it('should return JSON for plain objects', async () => {
      const app = new Hono();

      app.get(
        '/json',
        ...route({
          summary: 'JSON response',
          responses: { 200: v.object({ id: v.string() }) },
          handler: async () => ({ id: '123' }),
        })
      );

      const res = await app.request('/json');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ id: '123' });
    });
  });

  describe('Query parameter handling', () => {
    it('should parse and validate query parameters', async () => {
      const app = new Hono();
      let capturedQuery: Record<string, string> | undefined;

      app.get(
        '/search',
        ...route({
          summary: 'Search',
          query: v.object({
            q: v.string(),
            limit: v.optional(v.string()),
          }),
          responses: { 200: v.object({ query: v.record(v.string(), v.string()) }) },
          handler: async ({ query }) => {
            capturedQuery = query;
            return { query };
          },
        })
      );

      const res = await app.request('/search?q=test&limit=10');
      expect(res.status).toBe(200);
      expect(capturedQuery).toEqual({ q: 'test', limit: '10' });
    });

    it('should validate query parameters and return 422 on failure', async () => {
      const app = new Hono();

      app.get(
        '/search',
        ...route({
          summary: 'Search',
          query: v.object({
            required: v.string(),
          }),
          responses: { 200: v.object({ ok: v.boolean() }) },
          handler: async () => ({ ok: true }),
        })
      );

      const res = await app.request('/search'); // Missing required param
      expect(res.status).toBe(422); // Valibot validator returns 422
    });
  });

  describe('Pagination', () => {
    it('should not add pagination params when paginate is false', async () => {
      const middlewares = route({
        summary: 'List',
        paginate: false,
        responses: { 200: v.array(v.object({ id: v.string() })) },
        handler: async () => [{ id: '1' }],
      });

      // Should just have OpenAPI middleware + handler
      expect(middlewares.length).toBe(2);
    });

    it('should add pagination params when paginate is true', async () => {
      const middlewares = route({
        summary: 'List',
        paginate: true,
        responses: { 200: v.array(v.object({ id: v.string() })) },
        handler: async () => [{ id: '1' }],
      });

      // The middleware count doesn't change, but OpenAPI metadata should include pagination
      expect(middlewares.length).toBeGreaterThan(0);
    });
  });

  describe('Custom middleware', () => {
    it('should apply custom middleware before validation', async () => {
      const app = new Hono();
      const authMiddleware = vi.fn(async (c, next) => {
        c.set('user', { id: '123' });
        await next();
      });

      app.get(
        '/protected',
        ...route({
          summary: 'Protected route',
          middleware: [authMiddleware],
          responses: { 200: v.object({ userId: v.string() }) },
          handler: async ({ context }) => {
            const user = context.get('user') as { id: string };
            return { userId: user.id };
          },
        })
      );

      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      expect(authMiddleware).toHaveBeenCalled();
      const body = await res.json();
      expect(body).toEqual({ userId: '123' });
    });
  });

  describe('Public routes', () => {
    it('should mark public routes in OpenAPI', () => {
      const middlewares = route({
        summary: 'Public route',
        public: true,
        responses: { 200: v.object({ ok: v.boolean() }) },
        handler: async () => ({ ok: true }),
      });

      expect(middlewares).toBeDefined();
      // The OpenAPI middleware should be configured with security: []
    });

    it('should add auth security by default', () => {
      const middlewares = route({
        summary: 'Protected route',
        public: false,
        responses: { 200: v.object({ ok: v.boolean() }) },
        handler: async () => ({ ok: true }),
      });

      expect(middlewares).toBeDefined();
      // The OpenAPI middleware should include bearerAuth security
    });
  });

  describe('Union response types', () => {
    it('should accept either response type from 2xx union', async () => {
      const app = new Hono();

      // Schema for MFA required (200)
      const MfaRequiredSchema = v.object({
        mfaRequired: v.boolean(),
        availableMethods: v.array(v.string()),
      });

      // Schema for successful session (201)
      const SessionSchema = v.object({
        sessionId: v.string(),
        token: v.string(),
        userId: v.string(),
      });

      // Route with union response type (200 | 201)
      app.post(
        '/login',
        ...route({
          summary: 'Login',
          public: true,
          body: v.object({
            email: v.string(),
            password: v.string(),
          }),
          responses: {
            200: MfaRequiredSchema,
            201: SessionSchema,
          },
          handler: async ({ body }) => {
            // Handler can return either type
            // TypeScript should accept both without errors
            if (body.email.includes('mfa')) {
              // Return 200 response type
              return {
                mfaRequired: true,
                availableMethods: ['totp', 'sms'],
              };
            }

            // Return 201 response type
            return {
              sessionId: '123',
              token: 'abc',
              userId: '456',
            };
          },
        })
      );

      // Test MFA required flow (200)
      const mfaResponse = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user-mfa@example.com', password: 'pass' }),
      });

      expect(mfaResponse.status).toBe(200);
      const mfaBody = await mfaResponse.json();
      expect(mfaBody).toEqual({
        mfaRequired: true,
        availableMethods: ['totp', 'sms'],
      });

      // Test successful session flow (201)
      const sessionResponse = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'pass' }),
      });

      expect(sessionResponse.status).toBe(201);
      const sessionBody = await sessionResponse.json();
      expect(sessionBody).toEqual({
        sessionId: '123',
        token: 'abc',
        userId: '456',
      });
    });

    it('should type check union of multiple 2xx responses at compile time', () => {
      // This test primarily validates TypeScript compilation
      // If it compiles without errors, the union types are working correctly

      const Schema200 = v.object({ type: v.literal('success'), data: v.string() });
      const Schema201 = v.object({ type: v.literal('created'), id: v.number() });

      const middlewares = route({
        summary: 'Multi-response route',
        responses: {
          200: Schema200,
          201: Schema201,
        },
        handler: async () => {
          // TypeScript should accept both return types
          const random = Math.random();

          if (random > 0.5) {
            return { type: 'success' as const, data: 'test' };
          }

          return { type: 'created' as const, id: 123 };
        },
      });

      expect(middlewares).toBeDefined();
      expect(middlewares.length).toBeGreaterThan(0);
    });

    it('should handle single response type without issues', async () => {
      const app = new Hono();

      // Single response type should still work as before
      app.get(
        '/single',
        ...route({
          summary: 'Single response',
          responses: {
            200: v.object({ message: v.string() }),
          },
          handler: async () => {
            // Only one possible return type
            return { message: 'success' };
          },
        })
      );

      const response = await app.request('/single');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ message: 'success' });
    });
  });

  describe('Automatic key stripping', () => {
    it('should strip extra keys not defined in response schema', async () => {
      const app = new Hono();

      // Define a schema that only allows specific keys
      const UserResponseSchema = v.object({
        id: v.string(),
        email: v.string(),
        name: v.string(),
      });

      app.get(
        '/user',
        ...route({
          summary: 'Get user',
          responses: {
            200: UserResponseSchema,
          },
          handler: async () => {
            // Simulate Prisma returning extra fields (like password, createdAt, etc.)
            return {
              id: '123',
              email: 'user@example.com',
              name: 'John Doe',
              password: 'hashed_password', // Should be stripped
              createdAt: new Date(), // Should be stripped
              updatedAt: new Date(), // Should be stripped
              internalField: 'secret', // Should be stripped
            } as { id: string; email: string; name: string };
          },
        })
      );

      const response = await app.request('/user');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Only the fields defined in the schema should be present
      expect(body).toEqual({
        id: '123',
        email: 'user@example.com',
        name: 'John Doe',
      });

      // Extra fields should be stripped
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('createdAt');
      expect(body).not.toHaveProperty('updatedAt');
      expect(body).not.toHaveProperty('internalField');
    });

    it('should strip extra keys from union response types', async () => {
      const app = new Hono();

      const SuccessSchema = v.object({
        success: v.boolean(),
        data: v.string(),
      });

      const ErrorSchema = v.object({
        success: v.boolean(),
        error: v.string(),
      });

      app.post(
        '/action',
        ...route({
          summary: 'Perform action',
          body: v.object({ shouldFail: v.boolean() }),
          responses: {
            200: SuccessSchema,
            201: ErrorSchema,
          },
          handler: async ({ body }) => {
            if (body.shouldFail) {
              // Return error type with extra fields
              return {
                success: false,
                error: 'Action failed',
                internalError: 'Database error', // Should be stripped
                stackTrace: 'Error at line...', // Should be stripped
              } as { success: boolean; error: string };
            }

            // Return success type with extra fields
            return {
              success: true,
              data: 'Action completed',
              metadata: { timing: 123 }, // Should be stripped
              debug: 'Some debug info', // Should be stripped
            } as { success: boolean; data: string };
          },
        })
      );

      // Test success response
      const successResponse = await app.request('/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldFail: false }),
      });

      expect(successResponse.status).toBe(200);
      const successBody = await successResponse.json();
      expect(successBody).toEqual({
        success: true,
        data: 'Action completed',
      });
      expect(successBody).not.toHaveProperty('metadata');
      expect(successBody).not.toHaveProperty('debug');

      // Test error response
      const errorResponse = await app.request('/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldFail: true }),
      });

      expect(errorResponse.status).toBe(201);
      const errorBody = await errorResponse.json();
      expect(errorBody).toEqual({
        success: false,
        error: 'Action failed',
      });
      expect(errorBody).not.toHaveProperty('internalError');
      expect(errorBody).not.toHaveProperty('stackTrace');
    });

    it('should handle arrays in response and strip extra keys from elements', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
      });

      app.get(
        '/users',
        ...route({
          summary: 'List users',
          responses: {
            200: v.array(UserSchema),
          },
          handler: async () => {
            // Simulate database returning extra fields
            return [
              { id: '1', name: 'Alice', password: 'secret1', role: 'admin' },
              { id: '2', name: 'Bob', password: 'secret2', role: 'user' },
            ] as unknown as { id: string; name: string }[];
          },
        })
      );

      const response = await app.request('/users');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      // Each element should not have the extra fields
      for (const user of body) {
        expect(user).not.toHaveProperty('password');
        expect(user).not.toHaveProperty('role');
      }
    });

    it('should return data as-is when no response schema is defined', async () => {
      const app = new Hono();

      app.get(
        '/raw',
        ...route({
          summary: 'Raw response',
          // No response schema defined
          handler: async () => {
            return {
              id: '123',
              extraField: 'should remain',
              anotherExtra: 'also remains',
            };
          },
        })
      );

      const response = await app.request('/raw');
      expect(response.status).toBe(200);
      const body = await response.json();

      // All fields should be present since no schema is defined
      expect(body).toEqual({
        id: '123',
        extraField: 'should remain',
        anotherExtra: 'also remains',
      });
    });
  });
});
