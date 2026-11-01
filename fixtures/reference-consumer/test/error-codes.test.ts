import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAbilityFactory, createAuthMiddleware } from 'glasswork/auth';
import { bootstrap, defineModule } from 'glasswork/core';
import {
  ConflictException,
  createRoutes,
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from 'glasswork/http';
import * as v from 'valibot';
import { tokenProvider } from '../src/platform/auth.module.js';

const translations: Record<string, string> = {
  unauthenticated: 'Log opnieuw in.',
  'project-access-denied': 'Je hebt geen toegang.',
};

/** Like Route Rangers: the frontend translates a stable code, not the English message. */
async function startErrorApp(message = 'Authentication required') {
  const auth = createAuthMiddleware({
    provider: {
      ...tokenProvider,
      async validateSession(token) {
        if (token === 'unavailable') throw new Error('private database connection details');
        return tokenProvider.validateSession(token);
      },
    },
    buildAbility: createAbilityFactory<'Project', 'read'>()(() => {}),
    allowGuest: false,
    errors: {
      authenticationRequired: { message, code: 'unauthenticated' },
      forbidden: { message: 'Permission denied', code: 'project-access-denied' },
    },
  });
  const routes = createRoutes((router, _services, route) => {
    router.get('/protected', auth({ action: 'read', subject: 'Project' }), (c) => c.json({}));
    router.post(
      '/validate',
      ...route({
        body: v.object({ email: v.pipe(v.string(), v.email('Invalid email')) }),
        responses: { 200: v.object({}) },
        handler: () => ({}),
      })
    );
    router.get('/conflict', () => {
      throw new ConflictException('Already invited', { errorCode: 'already-invited' });
    });
  });
  return bootstrap(defineModule({ name: 'errors', basePath: 'errors', routes }), {
    environment: 'test',
  });
}

/** The structural decoding used by Route Rangers' create-actions accepts extra fields. */
function legacyMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || error instanceof Error) return undefined;
  return 'error' in error && typeof error.error === 'string' ? error.error : undefined;
}

describe('published error contract and translated auth codes', () => {
  it('keeps translation stable when the English message changes', async () => {
    for (const message of ['Authentication required', 'Please sign in']) {
      const application = await startErrorApp(message);
      try {
        const response = await application.app.request('/api/errors/protected');
        assert.equal(response.status, 401);
        const body = v.parse(ErrorResponseDto, await response.json());
        assert.equal(translations[body.code], 'Log opnieuw in.');
        assert.equal(legacyMessage(body), message);
        // The old published DTO used object(), which accepts an additional code field.
        assert.deepEqual(v.parse(v.object({ error: v.string() }), body), { error: message });
        // Strict client decoders must be migrated explicitly, as documented.
        assert.throws(() => v.parse(v.strictObject({ error: v.string() }), body));
      } finally {
        await application.stop();
      }
    }
  });

  it('clears an invalid cookie on 401, but retains a valid session on 403', async () => {
    const application = await startErrorApp();
    try {
      const invalid = await application.app.request('/api/errors/protected', {
        headers: { cookie: 'session=invalid' },
      });
      assert.equal(invalid.status, 401);
      assert.match(invalid.headers.get('set-cookie') ?? '', /Max-Age=0/);
      const denied = await application.app.request('/api/errors/protected', {
        headers: { cookie: 'session=alice-token' },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('set-cookie'), null);
      assert.equal(
        translations[v.parse(ErrorResponseDto, await denied.json()).code],
        'Je hebt geen toegang.'
      );
    } finally {
      await application.stop();
    }
  });

  it('retains the cookie on a provider outage and returns only a safe 503', async () => {
    const application = await startErrorApp();
    try {
      const response = await application.app.request('/api/errors/protected', {
        headers: { cookie: 'session=unavailable' },
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('set-cookie'), null);
      const text = await response.text();
      assert.equal(v.parse(ErrorResponseDto, JSON.parse(text)).code, 'auth-unavailable');
      assert.equal(text.includes('private database'), false);
    } finally {
      await application.stop();
    }
  });

  it('matches the published validation and domain error DTOs at runtime', async () => {
    const application = await startErrorApp();
    try {
      const invalid = await application.app.request('/api/errors/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'invalid' }),
      });
      assert.equal(invalid.status, 422);
      const body = v.parse(ValidationErrorResponseDto, await invalid.json());
      assert.equal(body.code, 'validation-failed');
      assert.deepEqual(body.issues, [{ message: 'Invalid email', path: ['email'] }]);
      const conflict = await application.app.request('/api/errors/conflict');
      assert.equal(conflict.status, 409);
      assert.equal(v.parse(ErrorResponseDto, await conflict.json()).code, 'already-invited');
    } finally {
      await application.stop();
    }
  });
});
