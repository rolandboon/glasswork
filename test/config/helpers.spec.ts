import { describe, expect, it } from 'vitest';
import {
  parseArray,
  parseBoolean,
  parseJson,
  toCamelCase,
  toSnakeCase,
} from '../../src/config/helpers.js';

describe('toCamelCase', () => {
  it('should convert SNAKE_CASE to camelCase', () => {
    expect(toCamelCase('DATABASE_URL')).toBe('databaseUrl');
    expect(toCamelCase('NODE_ENV')).toBe('nodeEnv');
    expect(toCamelCase('API_KEY')).toBe('apiKey');
  });

  it('should convert kebab-case to camelCase', () => {
    expect(toCamelCase('database-url')).toBe('databaseUrl');
    expect(toCamelCase('api-key')).toBe('apiKey');
  });

  it('should handle mixed separators', () => {
    expect(toCamelCase('my_api-key')).toBe('myApiKey');
  });

  it('should handle already camelCase strings', () => {
    expect(toCamelCase('databaseUrl')).toBe('databaseurl');
  });

  it('should handle single words', () => {
    expect(toCamelCase('PORT')).toBe('port');
    expect(toCamelCase('port')).toBe('port');
  });
});

describe('toSnakeCase', () => {
  it('should convert camelCase to UPPER_SNAKE_CASE', () => {
    expect(toSnakeCase('databaseUrl')).toBe('DATABASE_URL');
    expect(toSnakeCase('nodeEnv')).toBe('NODE_ENV');
    expect(toSnakeCase('apiKey')).toBe('API_KEY');
  });

  it('should handle PascalCase', () => {
    expect(toSnakeCase('DatabaseUrl')).toBe('DATABASE_URL');
  });

  it('should handle single words', () => {
    expect(toSnakeCase('port')).toBe('PORT');
  });

  it('should handle already SNAKE_CASE strings', () => {
    expect(toSnakeCase('DATABASE_URL')).toBe('D_A_T_A_B_A_S_E__U_R_L');
  });
});

describe('parseBoolean', () => {
  it('should parse true values', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('TRUE')).toBe(true);
    expect(parseBoolean('True')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('YES')).toBe(true);
    expect(parseBoolean('on')).toBe(true);
    expect(parseBoolean('ON')).toBe(true);
  });

  it('should parse false values', () => {
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('FALSE')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('no')).toBe(false);
    expect(parseBoolean('off')).toBe(false);
    expect(parseBoolean('anything')).toBe(false);
  });

  it('should handle whitespace', () => {
    expect(parseBoolean(' true ')).toBe(true);
    expect(parseBoolean(' false ')).toBe(false);
  });
});

describe('parseArray', () => {
  it('should parse comma-separated values', () => {
    expect(parseArray('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseArray('one,two,three')).toEqual(['one', 'two', 'three']);
  });

  it('should trim whitespace by default', () => {
    expect(parseArray('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(parseArray(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('should not trim when disabled', () => {
    expect(parseArray('a, b, c', false)).toEqual(['a', ' b', ' c']);
  });

  it('should handle empty strings', () => {
    expect(parseArray('')).toEqual([]);
  });

  it('should handle single values', () => {
    expect(parseArray('single')).toEqual(['single']);
  });

  it('should handle empty items', () => {
    expect(parseArray('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('parseJson', () => {
  it('should parse valid JSON', () => {
    expect(parseJson('{"key":"value"}')).toEqual({ key: 'value' });
    expect(parseJson('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    expect(parseJson('123')).toBe(123);
    expect(parseJson('true')).toBe(true);
  });

  it('should return undefined for invalid JSON', () => {
    expect(parseJson('invalid')).toBeUndefined();
    expect(parseJson('{')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });

  it('should handle complex objects', () => {
    const complex = {
      nested: { key: 'value' },
      array: [1, 2, 3],
      bool: true,
    };
    expect(parseJson(JSON.stringify(complex))).toEqual(complex);
  });
});
