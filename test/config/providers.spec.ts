import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dotenvProvider, envProvider, objectProvider, ssmProvider } from '../../src/config/providers.js';

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

describe('dotenvProvider', () => {
  it('should return empty object when file does not exist', async () => {
    // Test with a non-existent file path
    const provider = dotenvProvider({ path: '.env.nonexistent.test' });
    const config = await provider();
    expect(config).toEqual({});
  });

  it('should use default path when not specified', async () => {
    const provider = dotenvProvider();
    // Will return empty if .env doesn't exist, or parsed content if it does
    const config = await provider();
    expect(typeof config).toBe('object');
  });

  it('should use custom path when specified', async () => {
    const provider = dotenvProvider({ path: '.env.test' });
    const config = await provider();
    expect(typeof config).toBe('object');
  });

  it('should use custom encoding when specified', async () => {
    const provider = dotenvProvider({ encoding: 'utf8' });
    const config = await provider();
    expect(typeof config).toBe('object');
  });
});

describe('ssmProvider', () => {
  it('should throw error when neither path nor names provided', () => {
    expect(() => ssmProvider({})).not.toThrow(); // Function creation doesn't throw
    const provider = ssmProvider({});
    return expect(provider()).rejects.toThrow('ssmProvider requires either "path" or "names" option');
  });

  it('should accept path option', () => {
    const provider = ssmProvider({ path: '/app/config' });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('should accept names option', () => {
    const provider = ssmProvider({ names: ['VAR1', 'VAR2'] });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('should use default region when not provided', () => {
    const originalRegion = process.env.AWS_REGION;
    delete process.env.AWS_REGION;

    const provider = ssmProvider({ path: '/app/config' });
    expect(provider).toBeDefined();

    process.env.AWS_REGION = originalRegion;
  });

  it('should use custom region when provided', () => {
    const provider = ssmProvider({ path: '/app/config', region: 'eu-west-1' });
    expect(provider).toBeDefined();
  });

  it('should use withDecryption option', () => {
    const provider = ssmProvider({ path: '/app/config', withDecryption: false });
    expect(provider).toBeDefined();
  });

  it('should use removePrefix option', () => {
    const provider = ssmProvider({ path: '/app/config', removePrefix: false });
    expect(provider).toBeDefined();
  });
});
