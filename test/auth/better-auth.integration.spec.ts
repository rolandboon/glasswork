import { Ability } from '@casl/ability';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createBetterAuthProvider } from '../../src/auth/better-auth-provider.js';
import { createAuthMiddleware } from '../../src/auth/middleware.js';

function getSessionCookie(response: Response, cookieName: string): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${cookieName}=`));
  if (!cookie) throw new Error('Better Auth did not return a session cookie');
  return decodeURIComponent(cookie.slice(cookieName.length + 1).split(';')[0]);
}

describe('Better Auth provider integration', () => {
  it.each([
    {
      baseURL: 'http://localhost:3000',
      secure: undefined,
      customName: undefined,
      cookieName: 'better-auth.session_token',
    },
    {
      baseURL: 'https://example.com',
      secure: undefined,
      customName: undefined,
      cookieName: '__Secure-better-auth.session_token',
    },
    {
      baseURL: 'http://localhost:3000',
      secure: true,
      customName: undefined,
      cookieName: '__Secure-better-auth.session_token',
    },
    {
      baseURL: 'https://example.com',
      secure: undefined,
      customName: 'app-session',
      cookieName: '__Secure-app-session',
    },
  ])(
    'validates and revokes $cookieName at $baseURL',
    async ({ baseURL, secure, customName, cookieName }) => {
      const auth = betterAuth({
        database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
        baseURL,
        advanced: {
          useSecureCookies: secure,
          cookies: customName ? { session_token: { name: customName } } : undefined,
        },
        secret: 'glasswork-better-auth-integration-secret-123456789',
        emailAndPassword: { enabled: true },
      });
      const signUpResponse = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Integration Test',
            email: 'auth-integration@example.invalid',
            password: 'integration-test-password',
          }),
        })
      );
      const sessionCookie = getSessionCookie(signUpResponse, cookieName);
      const provider = createBetterAuthProvider({ auth });

      const activeSession = await provider.validateSession(sessionCookie);
      expect(activeSession).not.toBeNull();

      const authMiddleware = createAuthMiddleware({
        provider,
        buildAbility: () => new Ability(),
        allowGuest: false,
      });
      const app = new Hono();
      app.use('*', authMiddleware());
      app.get('/protected', (c) => c.json({ userId: c.get('user')?.id }));

      const authenticatedResponse = await app.request('/protected', {
        headers: { cookie: `${cookieName}=${sessionCookie}` },
      });
      expect(authenticatedResponse.status).toBe(200);

      await provider.invalidateSession(sessionCookie);

      expect(await provider.validateSession(sessionCookie)).toBeNull();
    }
  );
});
