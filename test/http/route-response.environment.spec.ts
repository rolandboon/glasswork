import * as v from 'valibot';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { Environment } from '../../src/core/types.js';
import { createRoutes } from '../../src/http/route-helpers.js';
import { createLogger } from '../../src/utils/logger.js';

type Runtime = 'node' | 'lambda';
type NodeEnv = 'unset' | 'test' | 'production';

const ItemDto = v.object({ id: v.string(), name: v.string() });

function createModule(body: Record<string, unknown>) {
  return defineModule({
    name: 'items',
    basePath: 'items',
    routes: createRoutes((router, _services, route) => {
      router.get(
        '/',
        ...route({
          summary: 'Get item',
          public: true,
          responses: { 200: ItemDto },
          handler: () => body as v.InferOutput<typeof ItemDto>,
        })
      );
    }),
  });
}

function stubRuntime(runtime: Runtime, nodeEnv: NodeEnv) {
  vi.stubEnv('NODE_ENV', nodeEnv === 'unset' ? undefined : nodeEnv);
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', runtime === 'lambda' ? 'api' : undefined);
  vi.stubEnv('LAMBDA_TASK_ROOT', undefined);
}

async function request(body: Record<string, unknown>, environment?: Environment) {
  const { app } = await bootstrap(createModule(body), {
    environment,
    logger: { instance: createLogger('test', 'silent') },
  });
  return app.request('/api/items');
}

const invalid = { id: 123, name: 'Widget', secret: 'secret-value' };
const valid = { id: 'a1', name: 'Widget', secret: 'secret-value' };

// Expected policy: only a resolved production environment rejects unmatched responses.
const autoDetected: Array<[Runtime, NodeEnv, number]> = [
  ['node', 'unset', 200],
  ['node', 'test', 200],
  ['node', 'production', 500],
  ['lambda', 'unset', 500],
  ['lambda', 'test', 200],
  ['lambda', 'production', 500],
];

const explicit: Array<[Environment, NodeEnv, number]> = [
  ['development', 'unset', 200],
  ['development', 'test', 200],
  ['development', 'production', 200],
  ['production', 'unset', 500],
  ['production', 'test', 500],
  ['production', 'production', 500],
];

describe('response validation follows the bootstrap environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(autoDetected)(
    'detected %s runtime with NODE_ENV %s answers %i for an unmatched response',
    async (runtime, nodeEnv, status) => {
      stubRuntime(runtime, nodeEnv);
      const response = await request(invalid);

      expect(response.status).toBe(status);
      if (status === 500) {
        expect(await response.text()).not.toContain('secret-value');
      }
    }
  );

  it.each(explicit)(
    'explicit %s environment with NODE_ENV %s answers %i for an unmatched response',
    async (environment, nodeEnv, status) => {
      stubRuntime('node', nodeEnv);
      const response = await request(invalid, environment);

      expect(response.status).toBe(status);
      if (status === 500) {
        expect(await response.text()).not.toContain('secret-value');
      }
    }
  );

  it.each([
    ...autoDetected.map(([runtime, nodeEnv]) => [runtime, nodeEnv, undefined] as const),
    ...explicit.map(([environment, nodeEnv]) => ['node', nodeEnv, environment] as const),
  ])(
    'strips undeclared keys from a valid response (%s, NODE_ENV %s, environment %s)',
    async (runtime, nodeEnv, environment) => {
      stubRuntime(runtime, nodeEnv);
      const response = await request(valid, environment);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 'a1', name: 'Widget' });
    }
  );

  it('hides serialization errors in production', async () => {
    stubRuntime('lambda', 'unset');
    const circular: Record<string, unknown> = { id: 'a1', name: 'Widget' };
    circular.self = circular;
    const response = await request(circular);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ message: 'Failed to serialize response data' });
  });
});
