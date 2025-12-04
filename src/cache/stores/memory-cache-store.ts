import type { CacheStore } from '../types.js';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * In-memory cache store - for testing only.
 * NOT suitable for Lambda production use.
 */
export class MemoryCacheStore implements CacheStore {
  readonly name = 'memory';

  private cache = new Map<string, MemoryEntry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    try {
      return JSON.parse(entry.value) as T;
    } catch {
      this.cache.delete(key);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    this.cache.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async delByPattern(pattern: string): Promise<number> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count += 1;
      }
    }

    return count;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}
