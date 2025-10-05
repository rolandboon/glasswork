/**
 * Creates a new object by omitting specified keys from the source object.
 *
 * This implementation preserves the object's prototype, making it suitable
 * for use with class instances and objects with custom prototypes.
 *
 * @template T - The type of the source object
 * @template K - The type of keys to omit (must be keys of T)
 * @param object - The source object to omit keys from
 * @param paths - Array of keys to omit from the object
 * @returns A new object with the specified keys omitted
 *
 * @example
 * ```typescript
 * const user = { id: 1, name: 'John', email: 'john@example.com', password: 'secret' };
 * const publicUser = omit(user, ['password']); // { id: 1, name: 'John', email: 'john@example.com' }
 * ```
 */
export function omit<T extends object, K extends keyof T>(object: T, paths: K[]): Omit<T, K> {
  const result = Object.create(Object.getPrototypeOf(object));

  for (const key in object) {
    if (Object.hasOwn(object, key) && !paths.includes(key as unknown as K)) {
      result[key] = object[key];
    }
  }

  return result;
}
