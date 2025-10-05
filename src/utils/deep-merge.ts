/**
 * Deep merge objects (simple implementation for small objects)
 */
export function deepMerge<T extends Record<string, unknown>>(
  ...objects: (T | Record<string, unknown>)[]
): T {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        const value = obj[key];

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          result[key] = deepMerge(
            (result[key] as Record<string, unknown>) || {},
            value as Record<string, unknown>
          );
        } else {
          result[key] = value;
        }
      }
    }
  }

  return result as T;
}
