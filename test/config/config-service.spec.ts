import { number, object, optional, string } from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  ConfigValidationException,
  createConfig,
  validateConfig,
} from '../../src/config/config-service.js';
import { objectProvider } from '../../src/config/providers.js';

describe('createConfig', () => {
  it('should create config from single provider', async () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    const config = await createConfig({
      schema,
      providers: [
        objectProvider({
          name: 'test-app',
          port: 3000,
        }),
      ],
    });

    expect(config.get('name')).toBe('test-app');
    expect(config.get('port')).toBe(3000);
    expect(config.data).toEqual({
      name: 'test-app',
      port: 3000,
    });
  });

  it('should merge multiple providers in order', async () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    const config = await createConfig({
      schema,
      providers: [
        objectProvider({ name: 'first', port: 3000 }),
        objectProvider({ name: 'second' }), // Overrides name, keeps port
      ],
    });

    expect(config.get('name')).toBe('second');
    expect(config.get('port')).toBe(3000);
  });

  it('should validate config and throw on invalid data', async () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    await expect(
      createConfig({
        schema,
        providers: [
          objectProvider({
            name: 'test',
            port: 'invalid', // Should be number
          }),
        ],
      })
    ).rejects.toThrow(ConfigValidationException);
  });

  it('should handle optional fields', async () => {
    const schema = object({
      name: string(),
      description: optional(string()),
    });

    const config = await createConfig({
      schema,
      providers: [objectProvider({ name: 'test' })],
    });

    expect(config.get('name')).toBe('test');
    expect(config.get('description')).toBeUndefined();
  });

  it('should transform keys when transformKey is provided', async () => {
    const schema = object({
      databaseUrl: string(),
      apiKey: string(),
    });

    const config = await createConfig({
      schema,
      providers: [
        objectProvider({
          DATABASE_URL: 'postgres://...',
          API_KEY: 'secret',
        }),
      ],
      transformKey: (key) => key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    });

    expect(config.get('databaseUrl')).toBe('postgres://...');
    expect(config.get('apiKey')).toBe('secret');
  });

  it('should use envProvider by default', async () => {
    const schema = object({
      TEST_VAR: string(),
    });

    process.env.TEST_VAR = 'from-env';

    const config = await createConfig({ schema });

    expect(config.get('TEST_VAR')).toBe('from-env');

    delete process.env.TEST_VAR;
  });

  it('should provide getOrDefault method', async () => {
    const schema = object({
      name: string(),
      port: optional(number()),
    });

    const config = await createConfig({
      schema,
      providers: [objectProvider({ name: 'test' })],
    });

    expect(config.getOrDefault('name', 'default')).toBe('test');
    expect(config.getOrDefault('port', 3000)).toBe(3000);
  });

  it('should allow unknown keys by default', async () => {
    const schema = object({
      name: string(),
    });

    const config = await createConfig({
      schema,
      providers: [
        objectProvider({
          name: 'test',
          extraKey: 'allowed',
        }),
      ],
    });

    expect(config.get('name')).toBe('test');
  });

  it('should filter unknown keys when allowUnknownKeys is false', async () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    const config = await createConfig({
      schema,
      providers: [
        objectProvider({
          name: 'test',
          port: 3000,
          extraKey: 'should-be-filtered',
          anotherExtra: 'also-filtered',
        }),
      ],
      allowUnknownKeys: false,
    });

    expect(config.get('name')).toBe('test');
    expect(config.get('port')).toBe(3000);
    expect(config.data).toEqual({
      name: 'test',
      port: 3000,
    });
    // Verify unknown keys are not in data
    expect('extraKey' in config.data).toBe(false);
    expect('anotherExtra' in config.data).toBe(false);
  });
});

describe('validateConfig', () => {
  it('should validate raw config data', () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    const config = validateConfig(schema, {
      name: 'test',
      port: 3000,
    });

    expect(config.get('name')).toBe('test');
    expect(config.get('port')).toBe(3000);
  });

  it('should throw on invalid data', () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    expect(() =>
      validateConfig(schema, {
        name: 'test',
        port: 'invalid',
      })
    ).toThrow(ConfigValidationException);
  });

  it('should provide validation issues', () => {
    const schema = object({
      name: string(),
      port: number(),
    });

    try {
      validateConfig(schema, {
        name: 'test',
        port: 'invalid',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationException);
      expect((error as ConfigValidationException).issues).toBeDefined();
      expect((error as ConfigValidationException).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('ConfigValidationException', () => {
  it('should have correct name and message', () => {
    const error = new ConfigValidationException('Test error', []);

    expect(error.name).toBe('ConfigValidationException');
    expect(error.message).toBe('Test error');
    expect(error.issues).toEqual([]);
  });

  it('should store validation issues', () => {
    const issues = [{ path: 'field', message: 'Invalid' }];
    const error = new ConfigValidationException('Validation failed', issues);

    expect(error.issues).toEqual(issues);
  });
});
