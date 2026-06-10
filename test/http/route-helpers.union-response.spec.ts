import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it } from 'vitest';
import { route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
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
});
