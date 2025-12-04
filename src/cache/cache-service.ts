import { createLogger } from '../utils/logger.js';
import type { CacheConfig, CacheEntry, CacheKeyFactory, CacheStore } from './types.js';

const logger = createLogger('Glasswork:Cache');

function isCacheEntry<T>(value: unknown): value is CacheEntry<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'cachedAt' in value &&
    typeof (value as CacheEntry<T>).cachedAt === 'number'
  );
}

export class CacheService {
  constructor(
    private readonly store: CacheStore,
    private readonly config: CacheConfig
  ) {
    if (config.defaultTTL <= 0) {
      throw new Error('Cache defaultTTL must be greater than 0 seconds');
    }
  }

  async get<T>(key: string | CacheKeyFactory<T>): Promise<T | undefined> {
    const entry = await this.getWithMetadata<T>(key);
    return entry?.value;
  }

  async getWithMetadata<T>(key: string | CacheKeyFactory<T>): Promise<CacheEntry<T> | undefined> {
    const prefixedKey = this.resolveKey(key);
    try {
      const result = await this.store.get<unknown>(prefixedKey);
      if (result === undefined) {
        return undefined;
      }

      if (isCacheEntry<T>(result)) {
        return result;
      }

      return {
        value: result as T,
        cachedAt: Date.now(),
      };
    } catch (error) {
      logger.warn(`Cache get failed for ${prefixedKey}`, error);
      return undefined;
    }
  }

  async set<T>(key: string | CacheKeyFactory<T>, value: T, ttl?: number): Promise<void> {
    const prefixedKey = this.resolveKey(key);
    const effectiveTTL = this.resolveTTL(ttl);

    try {
      await this.store.set<CacheEntry<T>>(prefixedKey, this.createEntry(value), effectiveTTL);
    } catch (error) {
      logger.warn(`Cache set failed for ${prefixedKey}`, error);
    }
  }

  async del(key: string | CacheKeyFactory<unknown>): Promise<void> {
    const prefixedKey = this.resolveKey(key);
    try {
      await this.store.del(prefixedKey);
    } catch (error) {
      logger.warn(`Cache delete failed for ${prefixedKey}`, error);
    }
  }

  async has(key: string | CacheKeyFactory<unknown>): Promise<boolean> {
    if (this.store.has) {
      try {
        return await this.store.has(this.resolveKey(key));
      } catch (error) {
        logger.warn(`Cache has check failed for ${this.resolveKey(key)}`, error);
        return false;
      }
    }

    const entry = await this.getWithMetadata(key);
    return entry !== undefined;
  }

  async wrap<T>(key: string | CacheKeyFactory<T>, ttl?: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  async wrapSWR<T>(
    key: string | CacheKeyFactory<T>,
    staleTTL: number,
    maxTTL: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const entry = await this.getWithMetadata<T>(key);

    if (!entry) {
      const value = await fn();
      await this.set(key, value, maxTTL);
      return value;
    }

    const age = Date.now() - entry.cachedAt;
    const isStale = age > staleTTL * 1000;

    if (isStale) {
      void this.refreshInBackground(key, maxTTL, fn);
    }

    return entry.value;
  }

  async delByPattern(pattern: string): Promise<number | undefined> {
    if (!this.store.delByPattern) {
      return undefined;
    }

    const prefixedPattern = this.config.keyPrefix ? `${this.config.keyPrefix}:${pattern}` : pattern;
    try {
      return await this.store.delByPattern(prefixedPattern);
    } catch (error) {
      logger.warn(`Cache pattern delete failed for ${prefixedPattern}`, error);
      return undefined;
    }
  }

  private resolveTTL(ttl?: number): number {
    const effectiveTTL = ttl ?? this.config.defaultTTL;
    if (effectiveTTL <= 0) {
      throw new Error('Cache TTL must be greater than 0 seconds');
    }
    return effectiveTTL;
  }

  private resolveKey<T>(key: string | CacheKeyFactory<T>): string {
    const baseKey = typeof key === 'function' ? key() : key;
    return this.config.keyPrefix ? `${this.config.keyPrefix}:${baseKey}` : baseKey;
  }

  private createEntry<T>(value: T): CacheEntry<T> {
    return { value, cachedAt: Date.now() };
  }

  private async refreshInBackground<T>(
    key: string | CacheKeyFactory<T>,
    ttl: number,
    fn: () => Promise<T>
  ): Promise<void> {
    try {
      const value = await fn();
      await this.set(key, value, ttl);
    } catch (error) {
      logger.warn(`Cache background refresh failed for ${this.resolveKey(key)}`, error);
    }
  }
}
