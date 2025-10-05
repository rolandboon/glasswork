/**
 * Type helper to recursively convert Date fields to string in an object type
 */
export type SerializedDates<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<SerializedDates<U>>
    : T extends object
      ? { [K in keyof T]: SerializedDates<T[K]> }
      : T;

/**
 * Recursively converts all Date objects to ISO 8601 strings in an entity or array of entities.
 *
 * This utility handles the mismatch between Prisma's Date types and API response DTOs
 * that expect string timestamps. It preserves null values and handles nested objects and arrays.
 *
 * @template T - The type of data to transform
 * @param data - The data to transform (object, array, or primitive)
 * @returns The same structure with all Date objects converted to ISO strings
 *
 * @example
 * ```typescript
 * const ranger = await prisma.ranger.findUnique({
 *   where: { id },
 *   include: { category: true }
 * });
 * return serializeDates(ranger); // All Date fields → ISO strings
 * ```
 */
export function serializeDates<T>(data: T): SerializedDates<T> {
  if (data === null || data === undefined) {
    return data as SerializedDates<T>;
  }

  if (data instanceof Date) {
    return data.toISOString() as SerializedDates<T>;
  }

  if (Array.isArray(data)) {
    return data.map((item) => serializeDates(item)) as SerializedDates<T>;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeDates(value);
    }
    return result as SerializedDates<T>;
  }

  return data as SerializedDates<T>;
}
