import { describe, expect, it } from 'vitest';
import { pick } from '../../src/utils/pick.js';

describe('pick', () => {
  interface TestObj {
    id: string;
    name: string;
    isActive: boolean;
    count?: number;
  }

  const mockObj: TestObj = {
    id: '1',
    name: 'Test',
    isActive: true,
    count: 42,
  };

  it('should pick a single specified key from the object', () => {
    const actualResult = pick(mockObj, ['id']);
    const expectedResult = { id: '1' };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).toHaveProperty('id');
    expect(actualResult).not.toHaveProperty('name');
    expect(actualResult).not.toHaveProperty('isActive');
  });

  it('should pick multiple specified keys from the object', () => {
    const actualResult = pick(mockObj, ['id', 'isActive']);
    const expectedResult = { id: '1', isActive: true };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).toHaveProperty('id');
    expect(actualResult).toHaveProperty('isActive');
    expect(actualResult).not.toHaveProperty('name');
    expect(actualResult).not.toHaveProperty('count');
  });

  it('should pick all keys when all are specified', () => {
    const actualResult = pick(mockObj, ['id', 'name', 'isActive', 'count']);

    expect(actualResult).toEqual(mockObj);
    expect(actualResult).not.toBe(mockObj); // Should be a new object
  });

  it('should return an empty object when no keys are provided', () => {
    const actualResult = pick(mockObj, []);

    expect(actualResult).toEqual({});
    expect(Object.keys(actualResult)).toHaveLength(0);
  });

  it('should not mutate the original object', () => {
    const originalObj = { ...mockObj };
    pick(mockObj, ['id', 'name']);

    expect(mockObj).toEqual(originalObj);
  });

  it('should handle objects with undefined values', () => {
    const inputObj = { id: '1', name: 'Test', value: undefined };
    const actualResult = pick(inputObj, ['id', 'value']);
    const expectedResult = { id: '1', value: undefined };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).toHaveProperty('value');
    expect(actualResult.value).toBeUndefined();
  });

  it('should work with nested objects', () => {
    const inputObj = {
      id: '1',
      user: { name: 'John', email: 'john@example.com' },
      isActive: true,
    };
    const actualResult = pick(inputObj, ['id', 'user']);
    const expectedResult = {
      id: '1',
      user: { name: 'John', email: 'john@example.com' },
    };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult.user).toBe(inputObj.user); // Should be the same reference
  });

  it('should handle optional properties correctly', () => {
    const inputObj: TestObj = { id: '1', name: 'Test', isActive: false };
    const actualResult = pick(inputObj, ['id', 'count']);
    const expectedResult = { id: '1' };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).not.toHaveProperty('count');
  });

  it('should preserve object prototype', () => {
    class TestClass {
      id = '1';
      name = 'Test';
      getValue() {
        return this.name;
      }
    }

    const inputObj = new TestClass();
    const actualResult = pick(inputObj, ['id']);

    expect(actualResult).toBeInstanceOf(TestClass);
    expect((actualResult as TestClass).getValue).toBeDefined();
    expect(actualResult.id).toBe('1');
    expect(actualResult).not.toHaveProperty('name');
  });

  it('should handle picking from objects with symbol keys', () => {
    const symbolKey = Symbol('test');
    const inputObj = {
      id: '1',
      name: 'Test',
      [symbolKey]: 'symbol-value',
    };
    const actualResult = pick(inputObj, ['id']);

    expect(actualResult).toEqual({ id: '1' });
    expect(actualResult).not.toHaveProperty('name');
  });

  it('should maintain type safety at compile time', () => {
    const inputObj = { id: '1', name: 'Test', count: 42 };
    const actualResult = pick(inputObj, ['id', 'name']);

    // TypeScript should infer the result type as { id: string; name: string; }
    expect(actualResult.id).toBe('1');
    expect(actualResult.name).toBe('Test');
    expect(actualResult).toEqual({ id: '1', name: 'Test' });
  });
});
