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
  constructor: { name: string };
  // Decimal.js internal structure
  s?: number; // sign
  e?: number; // exponent
  d?: number[]; // digits
}

/**
 * Maximum depth for recursive serialization.
 * Prevents stack overflow on deeply nested or circular structures.
 */
const MAX_SERIALIZATION_DEPTH = 20;

/**
 * Check if a value is a Decimal instance (from Prisma/Decimal.js)
 *
 * Uses multiple detection strategies:
 * 1. Checks for toNumber() method (primary indicator)
 * 2. Checks for Decimal.js internal structure (s, e, d properties)
 * 3. Checks constructor name as fallback
 *
 * This ensures we catch Prisma Decimal objects regardless of how they're constructed.
 */
function isDecimal(value: unknown): value is DecimalLike {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  // Must have toNumber method
  if (!('toNumber' in value) || typeof (value as { toNumber?: unknown }).toNumber !== 'function') {
    return false;
  }

  // Check for Decimal.js internal structure (most reliable indicator)
  const hasDecimalStructure =
    's' in value &&
    'e' in value &&
    'd' in value &&
    typeof (value as { s?: unknown }).s === 'number' &&
    typeof (value as { e?: unknown }).e === 'number' &&
    Array.isArray((value as { d?: unknown }).d);

  // Check constructor name as fallback
  const hasDecimalConstructor =
    'constructor' in value &&
    typeof value.constructor === 'object' &&
    value.constructor !== null &&
    'name' in value.constructor &&
    (value.constructor as { name?: unknown }).name === 'Decimal';

  // Accept if it has Decimal structure OR Decimal constructor name
  return hasDecimalStructure || hasDecimalConstructor;
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
  _ancestors = new WeakSet<object>()
): SerializedTypes<T> {
  // Guard: Maximum recursion depth (prevents stack overflow)
  if (_depth > MAX_SERIALIZATION_DEPTH) {
    throw new Error(
      `Maximum serialization depth (${MAX_SERIALIZATION_DEPTH}) exceeded. ` +
        'This might indicate a circular reference or extremely deep nesting.'
    );
  }

  // Null/undefined check
  if (data === null || data === undefined) {
    return data as SerializedTypes<T>;
  }

  // Only check for circular reference if it's in the CURRENT recursion path
  if (typeof data === 'object' && _ancestors.has(data)) {
    throw new Error(
      'Circular reference detected during serialization. ' +
        'The data structure contains a reference to an ancestor object.'
    );
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
    // Add to ancestors before recursing into children
    _ancestors.add(data);
    const result = data.map((item) =>
      serializePrismaTypes(item, config, _depth + 1, _ancestors)
    ) as SerializedTypes<T>;
    _ancestors.delete(data); // Remove when leaving this branch
    return result;
  }

  // Handle objects
  if (typeof data === 'object') {
    _ancestors.add(data);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializePrismaTypes(value, config, _depth + 1, _ancestors);
    }
    _ancestors.delete(data); // Remove when leaving this branch
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
export type PrismaDecimalLike = {
  toNumber(): number;
  constructor: { name: string };
};

/**
 * Common date field naming patterns used in databases.
 * Fields matching these patterns will accept Date objects in AcceptPrismaTypes.
 *
 * Patterns:
 * - `${string}At` - createdAt, updatedAt, deletedAt, expiresAt, etc.
 * - `${string}Date` - birthDate, startDate, endDate, effectiveDate, etc.
 * - `${string}Time` - startTime, endTime (when stored as Date/DateTime)
 * - `${string}Timestamp` - loginTimestamp, etc.
 * - Common standalone names: 'date', 'timestamp', 'datetime'
 */
type DateFieldPattern =
  | `${string}At`
  | `${string}Date`
  | `${string}Time`
  | `${string}Timestamp`
  | 'date'
  | 'timestamp'
  | 'datetime';

/**
 * Reverse type helper that accepts both serialized types AND their Prisma equivalents.
 * This allows handlers to return Prisma objects directly while TypeScript knows they'll be serialized.
 *
 * **How it works:**
 * - For Date fields: Only string fields with conventional date names (ending in `At`, `Date`, `Time`, etc.)
 *   accept Date objects. Other string fields only accept strings.
 * - For Decimal fields: All number fields accept Decimal-like objects (see rationale below).
 * - Recursively applies to objects and arrays.
 *
 * **Date Field Detection:**
 * Date fields are detected by naming convention. Fields ending in `At`, `Date`, `Time`, `Timestamp`,
 * or named `date`/`timestamp`/`datetime` will accept Date objects.
 *
 * If you have unconventionally named date fields, you have two options:
 * 1. Rename them to follow the convention (recommended)
 * 2. Use `strictTypes: true` in your route and handle types manually
 * 3. Provide additional patterns via the `AdditionalDatePatterns` type parameter
 *
 * **Why Decimal is still permissive:**
 * Unlike date fields which follow predictable naming conventions (`createdAt`, `updatedAt`, etc.),
 * Decimal fields have domain-specific names with no reliable pattern:
 * - `price`, `amount`, `balance` (finance)
 * - `density`, `thickness`, `weight` (physics/materials)
 * - `discountPercentage`, `taxRate` (percentages)
 * - `latitude`, `longitude` (coordinates)
 *
 * Since there's no reliable naming convention for Decimal fields, we keep them permissive.
 * In practice, developers rarely pass Decimal objects to non-decimal fields accidentally,
 * and runtime schema validation will catch any actual errors.
 *
 * @template T - The serialized type to transform
 * @template AdditionalDatePatterns - Optional additional patterns to match for date fields
 *
 * @example
 * ```typescript
 * // Schema definition
 * const UserSchema = v.object({
 *   id: v.string(),
 *   name: v.string(),
 *   createdAt: v.string(),  // Expects ISO string
 *   balance: v.number(),    // Expects number
 * });
 *
 * // ✅ Intended usage: Prisma types are automatically handled
 * handler: async () => {
 *   const user = await prisma.user.findUnique({ where: { id } });
 *   // user.createdAt is Date (matches 'At' pattern), user.balance is Decimal
 *   return user; // Works! Automatically serialized to match schema
 * }
 *
 * // ✅ Date fields with conventional names accept Date objects
 * handler: async () => {
 *   return {
 *     id: '123',
 *     name: 'John',
 *     createdAt: new Date(),           // ✅ 'createdAt' matches 'At' pattern
 *     birthDate: new Date(),           // ✅ 'birthDate' matches 'Date' pattern
 *     balance: new Decimal('100.50'),  // ✅ Decimal accepted for any number field
 *   };
 * }
 *
 * // ❌ Non-date string fields no longer accept Date (compile-time error)
 * handler: async () => {
 *   return {
 *     name: new Date(),  // ❌ Type error! 'name' doesn't match date patterns
 *     createdAt: '2025-01-01',
 *   };
 * }
 *
 * // Using additional date patterns for unconventional field names
 * type MyResponse = AcceptPrismaTypes<ResponseType, 'lastLogin' | 'nextRenewal'>;
 * ```
 */
/**
 * Helper type to add Date support to string types (including nullable strings).
 * Preserves null and undefined in unions.
 */
type WithDateSupport<T> = T extends string | infer Rest ? string | Date | Rest : T;

/**
 * Helper type to add Decimal support to number types (including nullable numbers).
 * Preserves null and undefined in unions.
 */
type WithDecimalSupport<T> = T extends number | infer Rest ? number | PrismaDecimalLike | Rest : T;

export type AcceptPrismaTypes<T, AdditionalDatePatterns extends string = never> = T extends object
  ? T extends Array<infer U>
    ? Array<AcceptPrismaTypes<U, AdditionalDatePatterns>>
    : {
        [K in keyof T]: K extends string
          ? K extends DateFieldPattern | AdditionalDatePatterns
            ? T[K] extends string | null | undefined
              ? WithDateSupport<T[K]>
              : AcceptPrismaTypes<T[K], AdditionalDatePatterns>
            : T[K] extends number | null | undefined
              ? WithDecimalSupport<T[K]>
              : AcceptPrismaTypes<T[K], AdditionalDatePatterns>
          : AcceptPrismaTypes<T[K], AdditionalDatePatterns>;
      }
  : T;
