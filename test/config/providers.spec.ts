import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envProvider, objectProvider } from '../../src/config/providers.js';

describe('envProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load all environment variables', async () => {
    process.env.TEST_VAR = 'value1';
    process.env.ANOTHER_VAR = 'value2';

    const provider = envProvider();
    const config = await provider();

    expect(config.TEST_VAR).toBe('value1');
    expect(config.ANOTHER_VAR).toBe('value2');
  });

  it('should filter by prefix', async () => {
    process.env.APP_NAME = 'myapp';
    process.env.APP_PORT = '3000';
    process.env.OTHER_VAR = 'excluded';

    const provider = envProvider({ prefix: 'APP_' });
    const config = await provider();

    expect(config.NAME).toBe('myapp');
    expect(config.PORT).toBe('3000');
    expect(config.OTHER_VAR).toBeUndefined();
    expect(config.APP_NAME).toBeUndefined();
  });

  it('should keep prefix when removePrefix is false', async () => {
    process.env.APP_NAME = 'myapp';
    process.env.APP_PORT = '3000';

    const provider = envProvider({ prefix: 'APP_', removePrefix: false });
    const config = await provider();

    expect(config.APP_NAME).toBe('myapp');
    expect(config.APP_PORT).toBe('3000');
    expect(config.NAME).toBeUndefined();
  });

  it('should skip undefined values', async () => {
    process.env.DEFINED = 'value';
    process.env.UNDEFINED = undefined;

    const provider = envProvider();
    const config = await provider();

    expect(config.DEFINED).toBe('value');
    expect('UNDEFINED' in config).toBe(false);
  });

  it('should handle empty environment', async () => {
    process.env = {};

    const provider = envProvider();
    const config = await provider();

    expect(Object.keys(config)).toHaveLength(0);
  });
});

describe('objectProvider', () => {
  it('should return the provided object', async () => {
    const config = { key1: 'value1', key2: 'value2' };
    const provider = objectProvider(config);

    const result = await provider();

    expect(result).toEqual(config);
  });

  it('should handle empty objects', async () => {
    const provider = objectProvider({});
    const result = await provider();

    expect(result).toEqual({});
  });

  it('should handle various value types', async () => {
    const config = {
      string: 'value',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      object: { nested: 'value' },
    };

    const provider = objectProvider(config);
    const result = await provider();

    expect(result).toEqual(config);
  });
});
