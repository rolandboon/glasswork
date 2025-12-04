/**
 * Cache configuration options.
 */
export interface CacheConfig {
  /**
   * Default time-to-live in seconds for cached entries.
   */
  defaultTTL: number;
  /**
   * Optional key prefix for namespacing cache entries.
   */
  keyPrefix?: string;
}

/**
 * Cached entry stored in the underlying cache store.
 */
export interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

/**
 * Cache store interface - implement this for custom stores.
 */
export interface CacheStore {
  /** Store name for logging/debugging. */
  readonly name: string;

  /**
   * Get a value from the cache.
   * @returns The cached value or undefined if not found/expired.
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Set a value in the cache.
   * @param key - Cache key.
   * @param value - Value to cache (should be JSON-serializable).
   * @param ttl - Time to live in seconds.
   */
  set<T>(key: string, value: T, ttl: number): Promise<void>;

  /**
   * Delete a value from the cache.
   */
  del(key: string): Promise<void>;

  /**
   * Delete multiple values by key pattern (if supported).
   * @returns Number of deleted keys, or undefined if not supported.
   */
  delByPattern?(pattern: string): Promise<number | undefined>;

  /**
   * Check if a key exists (without retrieving the value).
   */
  has?(key: string): Promise<boolean>;

  /**
   * Clear all cached values (use with caution).
   */
  clear?(): Promise<void>;
}

/**
 * Factory type for creating typed cache keys.
 */
export interface CacheKeyFactory<T> {
  (...args: unknown[]): string;
  __type?: T;
}

/**
 * Create a typed cache key factory.
 *
 * @example
 * const userKey = createCacheKey<User>('user', (id: string) => `user:${id}`);
 * await cache.get(userKey('123')); // User | undefined
 */
export function createCacheKey<T>(
  _name: string,
  keyFn: (...args: unknown[]) => string
): CacheKeyFactory<T> {
  const factory = (...args: unknown[]) => keyFn(...args);
  return Object.assign(factory, { __type: undefined as unknown as T });
}
