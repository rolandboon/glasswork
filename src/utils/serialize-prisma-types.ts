/**
 * Type helper to recursively convert Date and Decimal fields in an object type
 * - Date → string (ISO 8601)
 * - Decimal → number
 *
 * Note: Decimal is from Prisma's Decimal.js, but we don't import the type
 * to avoid hard dependency on @prisma/client
 */
export type SerializedTypes<T> = T extends Date
  ? string
  : T extends { constructor: { name: 'Decimal' } }
    ? number
    : T extends Array<infer U>
      ? Array<SerializedTypes<U>>
      : T extends object
        ? { [K in keyof T]: SerializedTypes<T[K]> }
        : T;

/**
 * Type for a transformer function that converts a value to a serializable type
 */
export type TypeTransformer = (value: unknown) => unknown;

/**
 * Configuration for type serialization
 */
export interface SerializationConfig {
  /**
   * Custom transformers to apply to specific types
   * The function should return the transformed value or undefined if not applicable
   */
  transformers: TypeTransformer[];
}

/**
 * Interface for Decimal-like objects (from Prisma/Decimal.js)
 * We define this interface to avoid importing from @prisma/client
 */
interface DecimalLike {
  toNumber(): number;
  constructor: { name: 'Decimal' };
}

/**
 * Check if a value is a Decimal instance (from Prisma/Decimal.js)
 */
function isDecimal(value: unknown): value is DecimalLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'constructor' in value &&
    value.constructor.name === 'Decimal' &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  );
}

/**
 * Default transformer that handles Date and Decimal types
 */
const defaultTransformer: TypeTransformer = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isDecimal(value)) {
    return value.toNumber();
  }
  return undefined; // Not handled by this transformer
};

/**
 * Default configuration with built-in transformers for Date and Decimal types.
 * Export this if you want to extend it with custom transformers.
 *
 * @example
 * ```typescript
 * import { defaultConfig, serializePrismaTypes } from './serialize-prisma-types';
 *
 * const customConfig = {
 *   transformers: [
 *     myCustomTransformer,
 *     ...defaultConfig.transformers, // Include Date/Decimal handling
 *   ],
 * };
 *
 * serializePrismaTypes(data, customConfig);
 * ```
 */
export const defaultConfig: SerializationConfig = {
  transformers: [defaultTransformer],
};

/**
 * Recursively converts Prisma types to JSON-serializable equivalents.
 *
 * This utility handles the mismatch between Prisma's data types and API response DTOs:
 * - Date objects → ISO 8601 strings
 * - Decimal objects → numbers
 *
 * It preserves null values and handles nested objects and arrays.
 * You can extend it with custom transformers for additional types.
 *
 * **Custom Transformers with AcceptPrismaTypes:**
 * ⚠️ Important: Custom transformers work at runtime, but `AcceptPrismaTypes` only knows
 * about Date and Decimal at compile-time. If you use custom transformers for other types,
 * you'll need to use type assertions or `strictTypes: true` in your route handlers.
 *
 * @template T - The type of data to transform
 * @param data - The data to transform (object, array, or primitive)
 * @param config - Optional configuration with custom transformers
 * @returns The same structure with Prisma types converted to JSON-serializable types
 *
 * @example
 * ```typescript
 * // Basic usage (Date/Decimal only)
 * const discount = await prisma.discount.findUnique({
 *   where: { id },
 * });
 * return serializePrismaTypes(discount);
 * // Date fields → ISO strings, Decimal fields → numbers
 *
 * // With custom transformer (requires type assertion in route handler)
 * class Money {
 *   constructor(public amount: number, public currency: string) {}
 *   serialize() { return `${this.amount} ${this.currency}`; }
 * }
 *
 * const customConfig = {
 *   transformers: [
 *     (value) => {
 *       if (value instanceof Money) return value.serialize();
 *       return undefined;
 *     },
 *     // Include default transformers
 *     (value) => {
 *       if (value instanceof Date) return value.toISOString();
 *       if (isDecimal(value)) return value.toNumber();
 *       return undefined;
 *     }
 *   ]
 * };
 *
 * // In route handler, you'll need to cast:
 * handler: async () => {
 *   const data = { balance: new Money(100, 'USD') };
 *   return serializePrismaTypes(data, customConfig) as ResponseType;
 * }
 * ```
 */
export function serializePrismaTypes<T>(
  data: T,
  config: SerializationConfig = defaultConfig,
  _depth = 0,
  _seen = new WeakSet<object>()
): SerializedTypes<T> {
  // Guard: Maximum recursion depth (prevents stack overflow)
  if (_depth > 20) {
    throw new Error(
      'Maximum serialization depth (20) exceeded. ' +
        'This might indicate a circular reference or extremely deep nesting.'
    );
  }

  // Null/undefined check
  if (data === null || data === undefined) {
    return data as SerializedTypes<T>;
  }

  // Guard: Circular reference detection
  if (typeof data === 'object' && _seen.has(data)) {
    throw new Error(
      'Circular reference detected during serialization. ' +
        'The data structure contains a reference to itself.'
    );
  }

  // Add object to seen set before processing
  if (typeof data === 'object') {
    _seen.add(data);
  }

  // Try each transformer
  for (const transformer of config.transformers) {
    const transformed = transformer(data);
    if (transformed !== undefined) {
      return transformed as SerializedTypes<T>;
    }
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) =>
      serializePrismaTypes(item, config, _depth + 1, _seen)
    ) as SerializedTypes<T>;
  }

  // Handle objects
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializePrismaTypes(value, config, _depth + 1, _seen);
    }
    return result as SerializedTypes<T>;
  }

  // Return primitives as-is
  return data as SerializedTypes<T>;
}

/**
 * Type representing Prisma's Decimal type structure.
 * We use a structural type to avoid importing from @prisma/client.
 * Prisma's Decimal has constructor.name as string (not literal 'Decimal'),
 * so we match on the toNumber() method which is the key interface we need.
 */
type PrismaDecimalLike = {
  toNumber(): number;
  constructor: { name: string };
};

/**
 * Reverse type helper that accepts both serialized types AND their Prisma equivalents.
 * This allows handlers to return Prisma objects directly while TypeScript knows they'll be serialized.
 *
 * **How it works:**
 * - string → string | Date (accepts both)
 * - number → number | Decimal-like (accepts both)
 * - Recursively applies to objects and arrays
 *
 * ⚠️ **Important Trade-off:**
 * This type will accept Date for ANY string field and Decimal for ANY number field in your response.
 * While this may seem overly permissive, it's a pragmatic trade-off that:
 * - ✅ Enables seamless Prisma type serialization without manual type assertions
 * - ✅ Maintains structural type safety (correct shape, correct property names)
 * - ✅ Relies on schema validation for format correctness (which you should have anyway)
 * - ⚠️ Allows theoretically incorrect assignments (e.g., Date to a 'name' field)
 *
 * In practice, you're unlikely to accidentally pass `new Date()` to a name field, and if you do,
 * Valibot validation will likely catch it at runtime.
 *
 * @example
 * ```typescript
 * // Schema definition
 * const UserSchema = v.object({
 *   id: v.string(),
 *   name: v.string(),
 *   createdAt: v.string(),  // Expects ISO string
 *   balance: v.number(),     // Expects number
 * });
 *
 * // ✅ Intended usage: Prisma types are automatically handled
 * handler: async () => {
 *   const user = await prisma.user.findUnique({ where: { id } });
 *   // user.createdAt is Date, user.balance is Decimal
 *   return user; // Works! Automatically serialized to match schema
 * }
 *
 * // ✅ Also works: Pre-serialized or mixed data
 * handler: async () => {
 *   return {
 *     id: '123',
 *     name: 'John',
 *     createdAt: new Date(),           // Date will be serialized
 *     balance: new Decimal('100.50'),  // Decimal will be serialized
 *   };
 * }
 *
 * // ⚠️ Type system allows this (but you probably won't write this accidentally)
 * handler: async () => {
 *   return {
 *     id: '123',
 *     name: new Date(),  // Type allows, but weird - who would do this?
 *     createdAt: '2025-01-01',
 *     balance: 100,
 *   };
 * }
 * // Note: Even if you did, schema validation might catch format issues
 *
 * // Type inference example
 * type ResponseType = AcceptPrismaTypes<{ createdAt: string; amount: number }>;
 * // Result: { createdAt: string | Date; amount: number | Decimal }
 * ```
 */
export type AcceptPrismaTypes<T> = T extends string
  ? string | Date
  : T extends number
    ? number | PrismaDecimalLike
    : T extends Array<infer U>
      ? Array<AcceptPrismaTypes<U>>
      : T extends object
        ? { [K in keyof T]: AcceptPrismaTypes<T[K]> }
        : T;
