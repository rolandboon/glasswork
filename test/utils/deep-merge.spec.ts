import { describe, expect, it } from 'vitest';
import { deepMerge } from '../../src/utils/deep-merge.js';

describe('deepMerge', () => {
  it('should merge simple objects', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { b: 3, c: 4 };

    const result = deepMerge(obj1, obj2);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deep merge nested objects', () => {
    const obj1 = { a: { x: 1, y: 2 }, b: 1 };
    const obj2 = { a: { y: 3, z: 4 }, c: 2 };

    const result = deepMerge(obj1, obj2);

    expect(result).toEqual({
      a: { x: 1, y: 3, z: 4 },
      b: 1,
      c: 2,
    });
  });

  it('should merge multiple objects', () => {
    const obj1 = { a: 1 };
    const obj2 = { b: 2 };
    const obj3 = { c: 3 };

    const result = deepMerge(obj1, obj2, obj3);

    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('should handle empty objects', () => {
    const result = deepMerge({}, { a: 1 }, {});

    expect(result).toEqual({ a: 1 });
  });

  it('should override arrays', () => {
    const obj1 = { a: [1, 2] };
    const obj2 = { a: [3, 4] };

    const result = deepMerge(obj1, obj2);

    expect(result).toEqual({ a: [3, 4] });
  });
});
