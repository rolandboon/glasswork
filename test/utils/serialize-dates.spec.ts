import { describe, expect, it } from 'vitest';
import { serializeDates } from '../../src/utils/serialize-dates.js';

describe('serializeDates', () => {
  it('should convert Date to ISO string', () => {
    const inputDate = new Date('2025-01-01T12:00:00Z');
    const actualResult = serializeDates(inputDate);

    expect(actualResult).toBe('2025-01-01T12:00:00.000Z');
  });

  it('should preserve null values', () => {
    const actualResult = serializeDates(null);
    expect(actualResult).toBeNull();
  });

  it('should preserve undefined values', () => {
    const actualResult = serializeDates(undefined);
    expect(actualResult).toBeUndefined();
  });

  it('should convert dates in objects', () => {
    const inputObj = {
      id: '123',
      createdAt: new Date('2025-01-01T12:00:00Z'),
      updatedAt: new Date('2025-01-02T12:00:00Z'),
    };

    const actualResult = serializeDates(inputObj);

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

    const actualResult = serializeDates(inputObj);

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

    const actualResult = serializeDates(inputArray);

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

    const actualResult = serializeDates(inputObj);

    expect(actualResult).toEqual({
      id: '123',
      deletedAt: null,
      createdAt: '2025-01-01T12:00:00.000Z',
    });
  });

  it('should preserve primitive values', () => {
    expect(serializeDates('test')).toBe('test');
    expect(serializeDates(123)).toBe(123);
    expect(serializeDates(true)).toBe(true);
    expect(serializeDates(false)).toBe(false);
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

    const actualResult = serializeDates(inputObj);

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
});
