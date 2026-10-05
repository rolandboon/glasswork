import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { object, string } from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap, defineModule, generateOpenAPI } from '../../src/core/index.js';
import { assertOpenAPIMatches, createRoutes } from '../../src/http/index.js';

describe('explicit bootstrap boundaries', () => {
  it('overrides providers before async initialization without mutating or sharing module state', async () => {
    const factory = vi.fn(async () => {
      throw new Error('runtime infrastructure');
    });
    const module = defineModule({
      name: 'override',
      providers: [{ provide: 'config', useFactory: factory }],
    });
    const results = await Promise.all(
      ['a', 'b'].map((value) =>
        bootstrap(module, {
          environment: 'test',
          providerOverrides: [{ provide: 'config', useValue: value }],
        })
      )
    );
    expect(results.map((result) => result.container.resolve('config'))).toEqual(['a', 'b']);
    expect(factory).not.toHaveBeenCalled();
    expect(module.providers?.[0]).toEqual({ provide: 'config', useFactory: factory });
    await Promise.all(results.map((result) => result.container.dispose()));
  });

  it('generates contracts with no runtime initialization and rejects HTTP and lifecycle use', async () => {
    const factory = vi.fn(async () => {
      throw new Error('database');
    });
    const module = defineModule({
      name: 'contract',
      basePath: 'contract',
      providers: [{ provide: 'service', useFactory: factory }],
      routes: createRoutes<{ service: { read(): { name: string } } }>(
        (router, { service }, route) => {
          router.get(
            '/',
            ...route({
              public: true,
              responses: { 200: object({ name: string() }) },
              handler: () => service.read(),
            })
          );
        }
      ),
    });
    const document = await generateOpenAPI(module, { environment: 'production' });
    expect(document.paths).toHaveProperty('/api/contract');
    expect(factory).not.toHaveBeenCalled();
    const result = await bootstrap(module, { mode: 'contract', environment: 'production' });
    expect((await result.app.request('/api/contract')).status).toBe(503);
    await expect(result.start()).rejects.toThrow('no runtime lifecycle');
    await result.container.dispose();

    const directory = await mkdtemp(join(tmpdir(), 'glasswork-contract-'));
    try {
      const path = join(directory, 'openapi.json');
      await writeFile(path, JSON.stringify(document));
      await expect(assertOpenAPIMatches(document, path)).resolves.toBeUndefined();
      await expect(assertOpenAPIMatches({ ...document, paths: {} }, path)).rejects.toThrow('drift');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires explicit values for dependencies used during route registration', async () => {
    const module = defineModule({
      name: 'registration',
      basePath: 'registration',
      providers: [{ provide: 'config', useFactory: () => ({ get: () => 'value' }) }],
      routes: createRoutes<{ config: { get(): string } }>((_router, { config }) => {
        config.get();
      }),
    });
    await expect(generateOpenAPI(module)).rejects.toThrow('explicit providerOverride');
    await expect(
      generateOpenAPI(module, {
        providerOverrides: [{ provide: 'config', useFactory: () => ({}) }],
      })
    ).rejects.toThrow('explicit values');
  });
});
