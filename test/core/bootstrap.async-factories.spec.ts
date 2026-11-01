import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import { cradleOf } from '../helpers/container.js';

describe('bootstrap', () => {
  it('should resolve async factory providers during bootstrap', async () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'asyncConfig',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { apiKey: 'async-key', timeout: 3000 };
          },
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('asyncConfig');
    const config = cradleOf(container).asyncConfig as { apiKey: string; timeout: number };
    // Should be the resolved value, not a Promise
    expect(config.apiKey).toBe('async-key');
    expect(config.timeout).toBe(3000);
  });

  it('should allow services to depend on async factory providers', async () => {
    interface Config {
      get(key: string): string;
    }

    class ApiService {
      private config: Config;
      constructor({ config }: { config: Config }) {
        this.config = config;
      }
      getEndpoint() {
        return this.config.get('apiUrl');
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'config',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            const values: Record<string, string> = {
              apiUrl: 'https://api.example.com',
              apiKey: 'secret-key',
            };
            return {
              get: (key: string) => values[key] ?? '',
            };
          },
        },
        ApiService,
      ],
    });

    const { container } = await bootstrap(module);

    // The service should have received the resolved config, not a Promise
    const apiService = cradleOf(container).apiService as ApiService;
    expect(apiService.getEndpoint()).toBe('https://api.example.com');
  });

  it('should resolve multiple async factory providers in correct order', async () => {
    const order: string[] = [];

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'configA',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push('A');
            return { name: 'A' };
          },
        },
        {
          provide: 'configB',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push('B');
            return { name: 'B' };
          },
        },
      ],
    });

    const { container } = await bootstrap(module);

    // Both should be resolved after bootstrap
    expect(cradleOf(container).configA).toEqual({ name: 'A' });
    expect(cradleOf(container).configB).toEqual({ name: 'B' });
    // Both were resolved during bootstrap
    expect(order).toContain('A');
    expect(order).toContain('B');
  });

  it('should handle mixed sync and async factory providers', async () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'syncValue',
          useFactory: () => ({ type: 'sync' }),
        },
        {
          provide: 'asyncValue',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { type: 'async' };
          },
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(cradleOf(container).syncValue).toEqual({ type: 'sync' });
    expect(cradleOf(container).asyncValue).toEqual({ type: 'async' });
  });

  it('should handle async factory that depends on another async factory', async () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'baseConfig',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { baseUrl: 'https://api.example.com' };
          },
        },
        {
          provide: 'derivedConfig',
          useFactory: async ({ baseConfig }: { baseConfig: { baseUrl: string } }) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { endpoint: `${baseConfig.baseUrl}/v1` };
          },
          inject: ['baseConfig'],
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(cradleOf(container).derivedConfig).toEqual({ endpoint: 'https://api.example.com/v1' });
  });

  describe('promise-returning factories', () => {
    // Bundlers that target older syntax turn async functions into ordinary functions.
    const transpiledAsync = (value: unknown) => () => Promise.resolve(value);

    it('rejects a singleton factory that returns a promise without being marked async', async () => {
      const { container } = await bootstrap(
        defineModule({
          name: 'settings',
          providers: [{ provide: 'config', useFactory: transpiledAsync({ url: 'db' }) }],
        }),
        { environment: 'test' }
      );

      expect(() => container.resolve('config')).toThrow(
        'Factory "config" in module "settings" returned a Promise. Use an async function or set async: true'
      );
    });

    it('fails bootstrap instead of injecting a pending promise into an async factory', async () => {
      await expect(
        bootstrap(
          defineModule({
            name: 'settings',
            providers: [
              { provide: 'config', useFactory: transpiledAsync({ url: 'db' }) },
              {
                provide: 'client',
                inject: ['config'],
                useFactory: async ({ config }: { config: { url: string } }) => ({
                  url: config.url,
                }),
              },
            ],
          }),
          { environment: 'test' }
        )
      ).rejects.toThrow('Factory "config" in module "settings" returned a Promise');
    });

    it('awaits a promise-returning factory marked async', async () => {
      const { container } = await bootstrap(
        defineModule({
          name: 'settings',
          providers: [
            { provide: 'config', async: true, useFactory: transpiledAsync({ url: 'db' }) },
            {
              provide: 'client',
              inject: ['config'],
              useFactory: async ({ config }: { config: { url: string } }) => ({ url: config.url }),
            },
          ],
        }),
        { environment: 'test' }
      );

      expect(container.resolve('config')).toEqual({ url: 'db' });
      expect(container.resolve('client')).toEqual({ url: 'db' });
    });

    it('rejects async: true outside singleton scope', async () => {
      await expect(
        bootstrap(
          defineModule({
            name: 'settings',
            providers: [
              {
                provide: 'config',
                async: true,
                scope: 'SCOPED',
                useFactory: transpiledAsync({}),
              },
            ],
          }),
          { environment: 'test' }
        )
      ).rejects.toThrow('Async factory "config" must use SINGLETON scope');
    });

    it('leaves scoped factories unexecuted at bootstrap and returns their result as-is', async () => {
      const factory = vi.fn(transpiledAsync({ id: 'user' }));
      const { container } = await bootstrap(
        defineModule({
          name: 'settings',
          providers: [{ provide: 'currentUser', scope: 'SCOPED', useFactory: factory }],
        }),
        { environment: 'test' }
      );

      expect(factory).not.toHaveBeenCalled();
      await expect(container.createScope().resolve('currentUser')).resolves.toEqual({
        id: 'user',
      });
    });
  });
});
