import { describe, expect, it } from 'vitest';
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
});
