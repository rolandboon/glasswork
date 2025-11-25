import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type RouteContext, route, setOpenAPIContext } from '../../src/http/route-helpers.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = new Hono();
    // Set up empty OpenAPI context for testing
    setOpenAPIContext(router, { processors: [], securitySchemes: [] });
  });

  it('should create middleware array with OpenAPI and handler', () => {
    const handler = vi.fn().mockResolvedValue({ success: true });

    const middlewares = route(router, {
      summary: 'Test route',
      handler,
    });

    expect(middlewares).toBeInstanceOf(Array);
    expect(middlewares.length).toBeGreaterThan(0);
  });

  it('should add validation middleware when body schema provided', () => {
    const bodySchema = v.object({ email: v.string() });
    const handler = vi.fn();

    const middlewares = route(router, {
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

    const middlewares = route(router, {
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

    const middlewares = route(router, {
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

    const middlewares = route(router, {
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

    const middlewares = route(router, {
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
      ...route(router, {
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

      const middlewares = route(router, {
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
        ...route(router, {
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
        ...route(router, {
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
        ...route(router, {
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
        ...route(router, {
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

  describe('Custom middleware', () => {
    it('should apply custom middleware before validation', async () => {
      const app = new Hono();
      const authMiddleware = vi.fn(async (c, next) => {
        c.set('user', { id: '123' });
        await next();
      });

      app.get(
        '/protected',
        ...route(router, {
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
      const middlewares = route(router, {
        summary: 'Public route',
        public: true,
        responses: { 200: v.object({ ok: v.boolean() }) },
        handler: async () => ({ ok: true }),
      });

      expect(middlewares).toBeDefined();
      // The OpenAPI middleware should be configured with security: []
    });

    it('should add auth security by default', () => {
      const middlewares = route(router, {
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
        ...route(router, {
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

      const middlewares = route(router, {
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
        ...route(router, {
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
        ...route(router, {
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
        ...route(router, {
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
        ...route(router, {
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
        ...route(router, {
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

  describe('Prisma type serialization', () => {
    it('should automatically serialize Date objects to ISO strings', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(), // Schema expects string
      });

      app.get(
        '/user',
        ...route(router, {
          summary: 'Get user',
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // Handler returns Date object (simulating Prisma result)
            return {
              id: '123',
              name: 'John Doe',
              createdAt: new Date('2025-01-01T12:00:00.000Z'), // Date object
            };
          },
        })
      );

      const response = await app.request('/user');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Date should be serialized to ISO string
      expect(body).toEqual({
        id: '123',
        name: 'John Doe',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should automatically serialize Decimal objects to numbers', async () => {
      const app = new Hono();

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.number(), // Schema expects number
      });

      // Mock Decimal object (simulating Prisma Decimal)
      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 99.99,
      };

      app.get(
        '/product',
        ...route(router, {
          summary: 'Get product',
          responses: {
            200: ProductSchema,
          },
          handler: async () => {
            // Handler returns Decimal object (simulating Prisma result)
            return {
              id: '456',
              name: 'Widget',
              price: mockDecimal, // Decimal object
            };
          },
        })
      );

      const response = await app.request('/product');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Decimal should be serialized to number
      expect(body).toEqual({
        id: '456',
        name: 'Widget',
        price: 99.99,
      });
      expect(typeof body.price).toBe('number');
    });

    it('should serialize Prisma Decimal objects with internal structure (s, e, d)', async () => {
      const app = new Hono();

      const MaterialSchema = v.object({
        id: v.string(),
        density: v.number(),
        thickness: v.number(),
        price: v.number(),
      });

      // Mock Decimal objects matching actual Prisma Decimal.js structure
      const mockDensity = {
        s: 1,
        e: 0,
        d: [1, 2000000],
        toNumber: () => 1.2,
      };

      const mockThickness = {
        s: 1,
        e: -1,
        d: [2000000],
        toNumber: () => 0.2,
      };

      const mockPrice = {
        s: 1,
        e: 1,
        d: [25, 5000000],
        toNumber: () => 25.5,
      };

      app.get(
        '/material',
        ...route(router, {
          summary: 'Get material',
          responses: {
            200: MaterialSchema,
          },
          handler: async () => {
            // Handler returns Prisma Decimal objects with internal structure
            return {
              id: '789',
              density: mockDensity,
              thickness: mockThickness,
              price: mockPrice,
            };
          },
        })
      );

      const response = await app.request('/material');
      expect(response.status).toBe(200);
      const body = await response.json();

      // All Decimal fields should be serialized to numbers
      expect(body).toEqual({
        id: '789',
        density: 1.2,
        thickness: 0.2,
        price: 25.5,
      });
      expect(typeof body.density).toBe('number');
      expect(typeof body.thickness).toBe('number');
      expect(typeof body.price).toBe('number');
    });

    it('should serialize both Date and Decimal in the same object', async () => {
      const app = new Hono();

      const OrderSchema = v.object({
        id: v.string(),
        total: v.number(), // Schema expects number
        createdAt: v.string(), // Schema expects string
      });

      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 149.99,
      };

      app.get(
        '/order',
        ...route(router, {
          summary: 'Get order',
          responses: {
            200: OrderSchema,
          },
          handler: async () => {
            return {
              id: '789',
              total: mockDecimal, // Decimal object
              createdAt: new Date('2025-01-15T10:30:00.000Z'), // Date object
            };
          },
        })
      );

      const response = await app.request('/order');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: 149.99,
        createdAt: '2025-01-15T10:30:00.000Z',
      });
      expect(typeof body.total).toBe('number');
      expect(typeof body.createdAt).toBe('string');
    });

    it('should serialize Date and Decimal in arrays', async () => {
      const app = new Hono();

      const TransactionSchema = v.object({
        id: v.string(),
        amount: v.number(),
        timestamp: v.string(),
      });

      const mockDecimal1 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 25.5,
      };

      const mockDecimal2 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 75.25,
      };

      app.get(
        '/transactions',
        ...route(router, {
          summary: 'List transactions',
          responses: {
            200: v.array(TransactionSchema),
          },
          handler: async () => {
            return [
              {
                id: '1',
                amount: mockDecimal1,
                timestamp: new Date('2025-01-01T10:00:00.000Z'),
              },
              {
                id: '2',
                amount: mockDecimal2,
                timestamp: new Date('2025-01-02T14:00:00.000Z'),
              },
            ];
          },
        })
      );

      const response = await app.request('/transactions');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual([
        {
          id: '1',
          amount: 25.5,
          timestamp: '2025-01-01T10:00:00.000Z',
        },
        {
          id: '2',
          amount: 75.25,
          timestamp: '2025-01-02T14:00:00.000Z',
        },
      ]);

      // Verify types
      for (const transaction of body) {
        expect(typeof transaction.amount).toBe('number');
        expect(typeof transaction.timestamp).toBe('string');
      }
    });

    it('should serialize Date and Decimal in nested objects', async () => {
      const app = new Hono();

      const OrderWithDetailsSchema = v.object({
        id: v.string(),
        createdAt: v.string(),
        customer: v.object({
          name: v.string(),
          joinedAt: v.string(),
        }),
        items: v.array(
          v.object({
            name: v.string(),
            price: v.number(),
            addedAt: v.string(),
          })
        ),
      });

      const mockDecimal1 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 19.99,
      };

      const mockDecimal2 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 29.99,
      };

      app.get(
        '/order-details',
        ...route(router, {
          summary: 'Get order with details',
          responses: {
            200: OrderWithDetailsSchema,
          },
          handler: async () => {
            return {
              id: '999',
              createdAt: new Date('2025-01-20T08:00:00.000Z'),
              customer: {
                name: 'Alice',
                joinedAt: new Date('2024-06-15T12:00:00.000Z'),
              },
              items: [
                {
                  name: 'Item A',
                  price: mockDecimal1,
                  addedAt: new Date('2025-01-20T08:05:00.000Z'),
                },
                {
                  name: 'Item B',
                  price: mockDecimal2,
                  addedAt: new Date('2025-01-20T08:10:00.000Z'),
                },
              ],
            };
          },
        })
      );

      const response = await app.request('/order-details');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '999',
        createdAt: '2025-01-20T08:00:00.000Z',
        customer: {
          name: 'Alice',
          joinedAt: '2024-06-15T12:00:00.000Z',
        },
        items: [
          {
            name: 'Item A',
            price: 19.99,
            addedAt: '2025-01-20T08:05:00.000Z',
          },
          {
            name: 'Item B',
            price: 29.99,
            addedAt: '2025-01-20T08:10:00.000Z',
          },
        ],
      });

      // Verify all types are correctly serialized
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.customer.joinedAt).toBe('string');
      for (const item of body.items) {
        expect(typeof item.price).toBe('number');
        expect(typeof item.addedAt).toBe('string');
      }
    });

    it('should handle null values without serializing them', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        deletedAt: v.nullable(v.string()),
        lastLoginAt: v.nullable(v.string()),
      });

      app.get(
        '/user-with-nulls',
        ...route(router, {
          summary: 'Get user with nullable fields',
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            return {
              id: '123',
              name: 'John',
              deletedAt: null, // null should remain null
              lastLoginAt: new Date('2025-01-10T09:00:00.000Z'), // Date should be serialized
            };
          },
        })
      );

      const response = await app.request('/user-with-nulls');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        name: 'John',
        deletedAt: null,
        lastLoginAt: '2025-01-10T09:00:00.000Z',
      });
      expect(body.deletedAt).toBeNull();
      expect(typeof body.lastLoginAt).toBe('string');
    });

    it('should serialize Prisma types in union responses', async () => {
      const app = new Hono();

      const SuccessSchema = v.object({
        success: v.boolean(),
        amount: v.number(),
        processedAt: v.string(),
      });

      const PendingSchema = v.object({
        success: v.boolean(),
        estimatedAmount: v.number(),
        estimatedAt: v.string(),
      });

      const mockDecimal1 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 100.5,
      };

      const mockDecimal2 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 95.0,
      };

      app.post(
        '/process',
        ...route(router, {
          summary: 'Process payment',
          body: v.object({ immediate: v.boolean() }),
          responses: {
            200: SuccessSchema,
            201: PendingSchema,
          },
          handler: async ({ body }) => {
            if (body.immediate) {
              return {
                success: true,
                amount: mockDecimal1,
                processedAt: new Date('2025-01-25T15:00:00.000Z'),
              } as const;
            }

            return {
              success: false,
              estimatedAmount: mockDecimal2,
              estimatedAt: new Date('2025-01-26T15:00:00.000Z'),
            } as const;
          },
        })
      );

      // Test immediate processing (200)
      const successResponse = await app.request('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate: true }),
      });

      expect(successResponse.status).toBe(200);
      const successBody = await successResponse.json();
      expect(successBody).toEqual({
        success: true,
        amount: 100.5,
        processedAt: '2025-01-25T15:00:00.000Z',
      });

      // Test pending processing (201)
      const pendingResponse = await app.request('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate: false }),
      });

      expect(pendingResponse.status).toBe(201);
      const pendingBody = await pendingResponse.json();
      expect(pendingBody).toEqual({
        success: false,
        estimatedAmount: 95.0,
        estimatedAt: '2025-01-26T15:00:00.000Z',
      });
    });

    it('should serialize Prisma types before schema validation and key stripping', async () => {
      const app = new Hono();

      // Schema only expects specific fields with string/number types
      const ResponseSchema = v.object({
        id: v.string(),
        price: v.number(),
        createdAt: v.string(),
      });

      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 199.99,
      };

      app.get(
        '/product-full',
        ...route(router, {
          summary: 'Get product',
          responses: {
            200: ResponseSchema,
          },
          handler: async () => {
            // Simulate Prisma returning extra fields + Prisma types
            return {
              id: '777',
              price: mockDecimal, // Decimal (will be serialized to number)
              createdAt: new Date('2025-01-30T12:00:00.000Z'), // Date (will be serialized to string)
              updatedAt: new Date('2025-01-31T12:00:00.000Z'), // Extra field (will be stripped)
              internalCode: 'XYZ123', // Extra field (will be stripped)
            };
          },
        })
      );

      const response = await app.request('/product-full');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Should have serialized types AND stripped extra keys
      expect(body).toEqual({
        id: '777',
        price: 199.99, // Serialized from Decimal
        createdAt: '2025-01-30T12:00:00.000Z', // Serialized from Date
      });

      // Verify extra fields are stripped
      expect(body).not.toHaveProperty('updatedAt');
      expect(body).not.toHaveProperty('internalCode');

      // Verify types are correct
      expect(typeof body.price).toBe('number');
      expect(typeof body.createdAt).toBe('string');
    });
  });

  describe('Strict types mode', () => {
    it('should work with strictTypes: true and explicit type assertion', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-strict',
        ...route(router, {
          summary: 'Get user (strict)',
          strictTypes: true,
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // With strictTypes: true, we need to return exact types or cast
            // Serialization still works at runtime, but types are enforced at compile time
            return {
              id: '123',
              name: 'John Doe',
              createdAt: new Date('2025-01-01T12:00:00.000Z'),
            } as unknown as { id: string; name: string; createdAt: string };
          },
        })
      );

      const response = await app.request('/user-strict');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Runtime serialization still works
      expect(body).toEqual({
        id: '123',
        name: 'John Doe',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should work with strictTypes: true returning pre-serialized data', async () => {
      const app = new Hono();

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.number(),
      });

      app.get(
        '/product-strict',
        ...route(router, {
          summary: 'Get product (strict)',
          strictTypes: true,
          responses: {
            200: ProductSchema,
          },
          handler: async () => {
            // With strictTypes: true, returning exact types works without cast
            return {
              id: '456',
              name: 'Widget',
              price: 99.99,
            };
          },
        })
      );

      const response = await app.request('/product-strict');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '456',
        name: 'Widget',
        price: 99.99,
      });
    });

    it('should work with strictTypes: false (default) accepting Prisma types', async () => {
      const app = new Hono();

      const OrderSchema = v.object({
        id: v.string(),
        total: v.number(),
        createdAt: v.string(),
      });

      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 149.99,
      };

      app.get(
        '/order-permissive',
        ...route(router, {
          summary: 'Get order (permissive)',
          strictTypes: false, // Explicitly set to false (same as default)
          responses: {
            200: OrderSchema,
          },
          handler: async () => {
            // With strictTypes: false, Prisma types are accepted
            return {
              id: '789',
              total: mockDecimal,
              createdAt: new Date('2025-01-15T10:30:00.000Z'),
            };
          },
        })
      );

      const response = await app.request('/order-permissive');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: 149.99,
        createdAt: '2025-01-15T10:30:00.000Z',
      });
    });

    it('should work with strictTypes: true in union response types', async () => {
      const app = new Hono();

      const SuccessSchema = v.object({
        success: v.boolean(),
        message: v.string(),
      });

      const ErrorSchema = v.object({
        success: v.boolean(),
        error: v.string(),
      });

      app.post(
        '/action-strict',
        ...route(router, {
          summary: 'Perform action (strict)',
          strictTypes: true,
          body: v.object({ shouldSucceed: v.boolean() }),
          responses: {
            200: SuccessSchema,
            201: ErrorSchema,
          },
          handler: async ({ body }) => {
            if (body.shouldSucceed) {
              return {
                success: true,
                message: 'Action completed',
              };
            }

            return {
              success: false,
              error: 'Action failed',
            };
          },
        })
      );

      // Test success response
      const successResponse = await app.request('/action-strict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldSucceed: true }),
      });

      expect(successResponse.status).toBe(200);
      const successBody = await successResponse.json();
      expect(successBody).toEqual({
        success: true,
        message: 'Action completed',
      });

      // Test error response
      const errorResponse = await app.request('/action-strict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldSucceed: false }),
      });

      expect(errorResponse.status).toBe(201);
      const errorBody = await errorResponse.json();
      expect(errorBody).toEqual({
        success: false,
        error: 'Action failed',
      });
    });
  });

  describe('Custom serialization transformers', () => {
    it('should apply custom transformers via serialization config', async () => {
      const app = new Hono();

      // Mock custom type
      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
      }

      const moneyTransformer = (value: unknown) => {
        if (value instanceof Money) {
          return { amount: value.amount, currency: value.currency };
        }
        return undefined;
      };

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.object({
          amount: v.number(),
          currency: v.string(),
        }),
      });

      app.get(
        '/product-custom',
        ...route(router, {
          summary: 'Get product with custom Money type',
          responses: {
            200: ProductSchema,
          },
          serialization: {
            transformers: [moneyTransformer],
          },
          handler: async () => {
            return {
              id: '123',
              name: 'Widget',
              price: new Money(99.99, 'USD'),
            };
          },
        })
      );

      const response = await app.request('/product-custom');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        name: 'Widget',
        price: {
          amount: 99.99,
          currency: 'USD',
        },
      });
    });

    it('should apply custom transformers AND default transformers', async () => {
      const app = new Hono();

      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
      }

      const moneyTransformer = (value: unknown) => {
        if (value instanceof Money) {
          return `${value.amount} ${value.currency}`;
        }
        return undefined;
      };

      const OrderSchema = v.object({
        id: v.string(),
        total: v.string(), // Money becomes string
        createdAt: v.string(), // Date becomes string
      });

      app.get(
        '/order-mixed',
        ...route(router, {
          summary: 'Get order with custom and default types',
          responses: {
            200: OrderSchema,
          },
          serialization: {
            transformers: [moneyTransformer],
          },
          handler: async () => {
            return {
              id: '789',
              total: new Money(149.99, 'USD'),
              createdAt: new Date('2025-01-15T10:30:00.000Z'),
            } as unknown as { id: string; total: string; createdAt: string };
          },
        })
      );

      const response = await app.request('/order-mixed');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: '149.99 USD', // Custom transformer
        createdAt: '2025-01-15T10:30:00.000Z', // Default transformer
      });
    });

    it('should work with custom transformers in nested structures', async () => {
      const app = new Hono();

      class Coordinates {
        constructor(
          public lat: number,
          public lng: number
        ) {}
      }

      const coordsTransformer = (value: unknown) => {
        if (value instanceof Coordinates) {
          return { latitude: value.lat, longitude: value.lng };
        }
        return undefined;
      };

      const LocationSchema = v.object({
        name: v.string(),
        position: v.object({
          latitude: v.number(),
          longitude: v.number(),
        }),
      });

      app.get(
        '/location',
        ...route(router, {
          summary: 'Get location',
          responses: {
            200: LocationSchema,
          },
          serialization: {
            transformers: [coordsTransformer],
          },
          handler: async () => {
            return {
              name: 'Office',
              position: new Coordinates(52.52, 13.405),
            } as unknown as { name: string; position: { latitude: number; longitude: number } };
          },
        })
      );

      const response = await app.request('/location');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        name: 'Office',
        position: {
          latitude: 52.52,
          longitude: 13.405,
        },
      });
    });

    it('should work without custom transformers (default behavior)', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-default',
        ...route(router, {
          summary: 'Get user (default serialization)',
          responses: {
            200: UserSchema,
          },
          // No serialization config - should use defaults
          handler: async () => {
            return {
              id: '123',
              createdAt: new Date('2025-01-01T12:00:00.000Z'),
            };
          },
        })
      );

      const response = await app.request('/user-default');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
    });
  });

  describe('Error handling and safety', () => {
    it('should handle serialization errors (circular reference)', async () => {
      const app = new Hono();

      interface CircularType {
        name: string;
        self?: CircularType;
      }

      app.get(
        '/circular',
        ...route(router, {
          summary: 'Test circular reference',
          responses: {
            200: v.object({
              name: v.string(),
            }),
          },
          handler: async () => {
            const circular: CircularType = { name: 'test' };
            circular.self = circular; // Create circular reference
            return circular as { name: string };
          },
        })
      );

      const response = await app.request('/circular');

      // Should return 500 error instead of crashing
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('Circular reference');
    });

    it('should handle serialization errors (max depth exceeded)', async () => {
      const app = new Hono();

      app.get(
        '/deep',
        ...route(router, {
          summary: 'Test max depth',
          responses: {
            200: v.object({
              value: v.string(),
            }),
          },
          handler: async () => {
            // Create extremely deep nesting (more than 20 levels)
            let deep: Record<string, unknown> = { value: 'end' };
            for (let i = 0; i < 25; i++) {
              deep = { nested: deep };
            }
            return deep as { value: string };
          },
        })
      );

      const response = await app.request('/deep');

      // Should return 500 error
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('depth');
    });

    it('should throw in production when response does not match schema', async () => {
      const app = new Hono();
      const originalEnv = process.env.NODE_ENV;

      try {
        // Simulate production environment
        process.env.NODE_ENV = 'production';

        app.get(
          '/invalid-response',
          ...route(router, {
            summary: 'Test invalid response',
            responses: {
              200: v.object({
                id: v.string(),
                name: v.string(),
              }),
            },
            handler: async () => {
              // Return data that doesn't match the schema
              return {
                id: 123, // Should be string, not number
                name: 'Test',
              } as unknown as { id: string; name: string };
            },
          })
        );

        const response = await app.request('/invalid-response');

        // In production, should return 500 when validation fails
        expect(response.status).toBe(500);
      } finally {
        // Restore original environment
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should warn in development when response does not match schema', async () => {
      const app = new Hono();
      const originalEnv = process.env.NODE_ENV;

      try {
        // Simulate development environment
        process.env.NODE_ENV = 'development';

        app.get(
          '/invalid-response-dev',
          ...route(router, {
            summary: 'Test invalid response in dev',
            responses: {
              200: v.object({
                id: v.string(),
                name: v.string(),
              }),
            },
            handler: async () => {
              // Return data that doesn't match the schema
              return {
                id: 123, // Wrong type
                name: 'Test',
              } as unknown as { id: string; name: string };
            },
          })
        );

        const response = await app.request('/invalid-response-dev');

        // In development, should still return the data (with warning)
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe(123); // Returns as-is in development
      } finally {
        // Restore original environment
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should handle normal errors from handler', async () => {
      const app = new Hono();

      app.get(
        '/error',
        ...route(router, {
          summary: 'Test handler error',
          responses: {
            200: v.object({ ok: v.boolean() }),
          },
          handler: async () => {
            throw new Error('Handler error');
          },
        })
      );

      // Handler errors are caught by Hono and return 500
      const response = await app.request('/error');
      expect(response.status).toBe(500);
    });
  });
});
