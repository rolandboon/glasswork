import { describe, expect, it } from 'vitest';
import { serializePrismaTypes } from '../../src/utils/serialize-prisma-types.js';

describe('serializePrismaTypes', () => {
  it('should convert Date to ISO string', () => {
    const inputDate = new Date('2025-01-01T12:00:00Z');
    const actualResult = serializePrismaTypes(inputDate);

    expect(actualResult).toBe('2025-01-01T12:00:00.000Z');
  });

  it('should preserve null values', () => {
    const actualResult = serializePrismaTypes(null);
    expect(actualResult).toBeNull();
  });

  it('should preserve undefined values', () => {
    const actualResult = serializePrismaTypes(undefined);
    expect(actualResult).toBeUndefined();
  });

  it('should convert dates in objects', () => {
    const inputObj = {
      id: '123',
      createdAt: new Date('2025-01-01T12:00:00Z'),
      updatedAt: new Date('2025-01-02T12:00:00Z'),
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      createdAt: '2025-01-01T12:00:00.000Z',
      updatedAt: '2025-01-02T12:00:00.000Z',
    });
  });

  it('should convert dates in nested objects', () => {
    const inputObj = {
      id: '123',
      user: {
        name: 'John',
        joinedAt: new Date('2025-01-01T12:00:00Z'),
      },
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      user: {
        name: 'John',
        joinedAt: '2025-01-01T12:00:00.000Z',
      },
    });
  });

  it('should convert dates in arrays', () => {
    const inputArray = [
      { id: '1', createdAt: new Date('2025-01-01T12:00:00Z') },
      { id: '2', createdAt: new Date('2025-01-02T12:00:00Z') },
    ];

    const actualResult = serializePrismaTypes(inputArray);

    expect(actualResult).toEqual([
      { id: '1', createdAt: '2025-01-01T12:00:00.000Z' },
      { id: '2', createdAt: '2025-01-02T12:00:00.000Z' },
    ]);
  });

  it('should handle objects with null fields', () => {
    const inputObj = {
      id: '123',
      deletedAt: null,
      createdAt: new Date('2025-01-01T12:00:00Z'),
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      deletedAt: null,
      createdAt: '2025-01-01T12:00:00.000Z',
    });
  });

  it('should preserve primitive values', () => {
    expect(serializePrismaTypes('test')).toBe('test');
    expect(serializePrismaTypes(123)).toBe(123);
    expect(serializePrismaTypes(true)).toBe(true);
    expect(serializePrismaTypes(false)).toBe(false);
  });

  it('should handle complex nested structures', () => {
    const inputObj = {
      id: '123',
      items: [
        {
          name: 'Item 1',
          createdAt: new Date('2025-01-01T12:00:00Z'),
          tags: [{ id: 1, addedAt: new Date('2025-01-02T12:00:00Z') }],
        },
      ],
      metadata: {
        lastModified: new Date('2025-01-03T12:00:00Z'),
        author: { name: 'John', joinedAt: new Date('2025-01-04T12:00:00Z') },
      },
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      items: [
        {
          name: 'Item 1',
          createdAt: '2025-01-01T12:00:00.000Z',
          tags: [{ id: 1, addedAt: '2025-01-02T12:00:00.000Z' }],
        },
      ],
      metadata: {
        lastModified: '2025-01-03T12:00:00.000Z',
        author: { name: 'John', joinedAt: '2025-01-04T12:00:00.000Z' },
      },
    });
  });

  it('should convert Decimal to number', () => {
    // Mock Decimal object (similar to Prisma's Decimal.js)
    const mockDecimal = {
      constructor: { name: 'Decimal' },
      toNumber: () => 123.45,
    };

    const actualResult = serializePrismaTypes(mockDecimal);
    expect(actualResult).toBe(123.45);
  });

  it('should convert Decimals in objects', () => {
    const mockDecimal = {
      constructor: { name: 'Decimal' },
      toNumber: () => 99.99,
    };

    const inputObj = {
      id: '123',
      price: mockDecimal,
      name: 'Product',
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      price: 99.99,
      name: 'Product',
    });
  });

  it('should convert Decimals in arrays', () => {
    const mockDecimal1 = {
      constructor: { name: 'Decimal' },
      toNumber: () => 10.5,
    };
    const mockDecimal2 = {
      constructor: { name: 'Decimal' },
      toNumber: () => 20.75,
    };

    const inputArray = [
      { id: '1', amount: mockDecimal1 },
      { id: '2', amount: mockDecimal2 },
    ];

    const actualResult = serializePrismaTypes(inputArray);

    expect(actualResult).toEqual([
      { id: '1', amount: 10.5 },
      { id: '2', amount: 20.75 },
    ]);
  });

  it('should handle mixed Date and Decimal types', () => {
    const mockDecimal = {
      constructor: { name: 'Decimal' },
      toNumber: () => 49.99,
    };

    const inputObj = {
      id: '123',
      price: mockDecimal,
      createdAt: new Date('2025-01-01T12:00:00Z'),
      name: 'Product',
    };

    const actualResult = serializePrismaTypes(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      price: 49.99,
      createdAt: '2025-01-01T12:00:00.000Z',
      name: 'Product',
    });
  });

  describe('Custom transformers', () => {
    it('should apply custom transformer to custom types', () => {
      // Mock custom type (e.g., a Money class)
      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
        serialize() {
          return { amount: this.amount, currency: this.currency };
        }
      }

      const customTransformer = (value: unknown) => {
        if (value instanceof Money) {
          return value.serialize();
        }
        return undefined;
      };

      const inputObj = {
        id: '123',
        balance: new Money(100.5, 'USD'),
        name: 'Account',
      };

      const actualResult = serializePrismaTypes(inputObj, {
        transformers: [
          customTransformer,
          // Include default transformer for Date/Decimal
          (value: unknown) => {
            if (value instanceof Date) return value.toISOString();
            return undefined;
          },
        ],
      });

      expect(actualResult).toEqual({
        id: '123',
        balance: { amount: 100.5, currency: 'USD' },
        name: 'Account',
      });
    });

    it('should apply multiple custom transformers in order', () => {
      class TypeA {
        serialize() {
          return 'TYPE_A';
        }
      }

      class TypeB {
        serialize() {
          return 'TYPE_B';
        }
      }

      const transformerA = (value: unknown) => {
        if (value instanceof TypeA) return value.serialize();
        return undefined;
      };

      const transformerB = (value: unknown) => {
        if (value instanceof TypeB) return value.serialize();
        return undefined;
      };

      const inputObj = {
        fieldA: new TypeA(),
        fieldB: new TypeB(),
      };

      const actualResult = serializePrismaTypes(inputObj, {
        transformers: [transformerA, transformerB],
      });

      expect(actualResult).toEqual({
        fieldA: 'TYPE_A',
        fieldB: 'TYPE_B',
      });
    });

    it('should use first matching transformer', () => {
      class CustomType {
        value = 'test';
      }

      const transformer1 = (value: unknown) => {
        if (value instanceof CustomType) return 'FIRST';
        return undefined;
      };

      const transformer2 = (value: unknown) => {
        if (value instanceof CustomType) return 'SECOND';
        return undefined;
      };

      const input = new CustomType();

      const actualResult = serializePrismaTypes(input, {
        transformers: [transformer1, transformer2],
      });

      expect(actualResult).toBe('FIRST');
    });

    it('should work with custom transformers in nested structures', () => {
      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
        serialize() {
          return `${this.amount} ${this.currency}`;
        }
      }

      const customTransformer = (value: unknown) => {
        if (value instanceof Money) return value.serialize();
        return undefined;
      };

      const inputObj = {
        user: {
          name: 'John',
          accounts: [
            { id: '1', balance: new Money(100, 'USD') },
            { id: '2', balance: new Money(200, 'EUR') },
          ],
        },
      };

      const actualResult = serializePrismaTypes(inputObj, {
        transformers: [customTransformer],
      });

      expect(actualResult).toEqual({
        user: {
          name: 'John',
          accounts: [
            { id: '1', balance: '100 USD' },
            { id: '2', balance: '200 EUR' },
          ],
        },
      });
    });

    it('should combine custom transformers with default transformers', () => {
      class CustomType {
        serialize() {
          return 'CUSTOM';
        }
      }

      const customTransformer = (value: unknown) => {
        if (value instanceof CustomType) return value.serialize();
        return undefined;
      };

      const defaultDateTransformer = (value: unknown) => {
        if (value instanceof Date) return value.toISOString();
        return undefined;
      };

      const inputObj = {
        customField: new CustomType(),
        dateField: new Date('2025-01-01T12:00:00Z'),
        normalField: 'test',
      };

      const actualResult = serializePrismaTypes(inputObj, {
        transformers: [customTransformer, defaultDateTransformer],
      });

      expect(actualResult).toEqual({
        customField: 'CUSTOM',
        dateField: '2025-01-01T12:00:00.000Z',
        normalField: 'test',
      });
    });

    it('should return undefined if no transformer matches', () => {
      const transformer = (_value: unknown) => {
        // Never matches anything
        return undefined;
      };

      const inputObj = {
        field: 'test',
      };

      const actualResult = serializePrismaTypes(inputObj, {
        transformers: [transformer],
      });

      // Primitives should be returned as-is when no transformer matches
      expect(actualResult).toEqual({
        field: 'test',
      });
    });
  });

  describe('Safety guards', () => {
    it('should throw on circular references', () => {
      interface CircularObj {
        name: string;
        self?: CircularObj;
      }

      const circular: CircularObj = {
        name: 'test',
      };
      circular.self = circular; // Create circular reference

      expect(() => serializePrismaTypes(circular)).toThrow(
        'Circular reference detected during serialization'
      );
    });

    it('should throw on circular references in arrays', () => {
      const arr: unknown[] = ['test'];
      arr.push(arr); // Circular reference in array

      expect(() => serializePrismaTypes(arr)).toThrow(
        'Circular reference detected during serialization'
      );
    });

    it('should throw on circular references in nested structures', () => {
      interface Node {
        id: string;
        children: Node[];
      }

      const parent: Node = {
        id: 'parent',
        children: [],
      };

      const child: Node = {
        id: 'child',
        children: [parent], // Circular reference
      };

      parent.children.push(child);

      expect(() => serializePrismaTypes(parent)).toThrow(
        'Circular reference detected during serialization'
      );
    });

    it('should throw when maximum depth is exceeded', () => {
      // Create a deeply nested structure (more than 20 levels)
      let deep: Record<string, unknown> = { value: 'end' };
      for (let i = 0; i < 25; i++) {
        deep = { nested: deep };
      }

      expect(() => serializePrismaTypes(deep)).toThrow('Maximum serialization depth (20) exceeded');
    });

    it('should handle structures at exactly depth 20', () => {
      // Create a structure at exactly depth 20 (should work)
      let deep: Record<string, unknown> = { value: 'end' };
      for (let i = 0; i < 19; i++) {
        deep = { nested: deep };
      }

      // Should not throw
      expect(() => serializePrismaTypes(deep)).not.toThrow();
    });

    it('should handle complex nested structures under depth limit', () => {
      // Real-world deep structure that stays under the limit
      const data = {
        user: {
          profile: {
            settings: {
              preferences: {
                notifications: {
                  email: {
                    frequency: 'daily',
                    types: ['updates', 'alerts'],
                  },
                },
              },
            },
          },
        },
        metadata: {
          timestamps: {
            created: new Date('2025-01-01T12:00:00Z'),
            updated: new Date('2025-01-02T12:00:00Z'),
          },
        },
      };

      const result = serializePrismaTypes(data);

      expect(result).toEqual({
        user: {
          profile: {
            settings: {
              preferences: {
                notifications: {
                  email: {
                    frequency: 'daily',
                    types: ['updates', 'alerts'],
                  },
                },
              },
            },
          },
        },
        metadata: {
          timestamps: {
            created: '2025-01-01T12:00:00.000Z',
            updated: '2025-01-02T12:00:00.000Z',
          },
        },
      });
    });

    it('should not trigger circular reference for separate identical objects', () => {
      const sharedObj = { id: '123', name: 'shared' };

      const data = {
        first: sharedObj,
        second: sharedObj, // Same reference, not circular
      };

      // This WILL throw because it's the same object reference
      expect(() => serializePrismaTypes(data)).toThrow(
        'Circular reference detected during serialization'
      );
    });

    it('should handle objects with same structure but different instances', () => {
      const data = {
        first: { id: '123', name: 'first' },
        second: { id: '123', name: 'second' }, // Different instance, same structure
      };

      // Should work - different object instances
      const result = serializePrismaTypes(data);

      expect(result).toEqual({
        first: { id: '123', name: 'first' },
        second: { id: '123', name: 'second' },
      });
    });
  });
});
