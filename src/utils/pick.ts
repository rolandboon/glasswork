/**
 * Creates a new object by picking specified keys from the source object.
 *
 * This implementation preserves the object's prototype, making it suitable
 * for use with class instances and objects with custom prototypes.
 *
 * @template T - The type of the source object
 * @template K - The type of keys to pick (must be keys of T)
 * @param obj - The source object to pick keys from
 * @param paths - Array of keys to pick from the object
 * @returns A new object containing only the specified keys
 *
 * @example
 * ```typescript
 * const user = { id: 1, name: 'John', email: 'john@example.com', password: 'secret' };
 * const publicUser = pick(user, ['id', 'name']); // { id: 1, name: 'John' }
 * ```
 */
export function pick<T extends object, K extends keyof T>(obj: T, paths: K[]): Pick<T, K> {
  const result = Object.create(Object.getPrototypeOf(obj)) as Pick<T, K>;

  for (const key of paths) {
    if (Object.hasOwn(obj, key)) {
      result[key] = obj[key];
    }
  }

  return result;
}
