import { describe, expect, it } from 'vitest';
import { omit } from '../../src/utils/omit.js';

describe('omit', () => {
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

  it('should omit a single specified key from the object', () => {
    const actualResult = omit(mockObj, ['isActive']);
    const expectedResult = { id: '1', name: 'Test', count: 42 };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).not.toHaveProperty('isActive');
  });

  it('should omit multiple specified keys from the object', () => {
    const actualResult = omit(mockObj, ['isActive', 'count']);
    const expectedResult = { id: '1', name: 'Test' };

    expect(actualResult).toEqual(expectedResult);
    expect(actualResult).not.toHaveProperty('isActive');
    expect(actualResult).not.toHaveProperty('count');
  });

  it('should return an equivalent object when no keys are omitted', () => {
    const actualResult = omit(mockObj, []);

    expect(actualResult).toEqual(mockObj);
    expect(actualResult).not.toBe(mockObj); // Should be a new object
  });

  it('should handle omitting all keys from the object', () => {
    const actualResult = omit(mockObj, ['id', 'name', 'isActive', 'count']);
    const expectedResult = {};

    expect(actualResult).toEqual(expectedResult);
  });

  it('should not mutate the original object', () => {
    const originalObj = { ...mockObj };
    omit(mockObj, ['isActive']);

    expect(mockObj).toEqual(originalObj);
  });

  it('should handle objects with undefined values', () => {
    const inputObj = { id: '1', name: 'Test', value: undefined };
    const actualResult = omit(inputObj, ['value']);
    const expectedResult = { id: '1', name: 'Test' };

    expect(actualResult).toEqual(expectedResult);
  });

  it('should work with nested objects', () => {
    const inputObj = {
      id: '1',
      user: { name: 'John', email: 'john@example.com' },
      isActive: true,
    };
    const actualResult = omit(inputObj, ['isActive']);
    const expectedResult = {
      id: '1',
      user: { name: 'John', email: 'john@example.com' },
    };

    expect(actualResult).toEqual(expectedResult);
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
    const actualResult = omit(inputObj, ['name']);

    expect(actualResult).toBeInstanceOf(TestClass);
    expect(actualResult.getValue).toBeDefined();
    expect(actualResult.id).toBe('1');
    expect(actualResult).not.toHaveProperty('name');
  });
});
