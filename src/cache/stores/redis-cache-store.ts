import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import type { CacheStore } from '../types.js';

const logger = createLogger('Glasswork:Cache:Redis');

export interface RedisCacheStoreConfig {
  /** Redis connection URL. */
  url: string;
  /** Additional ioredis options. */
  options?: Record<string, unknown>;
}

/**
 * Redis cache store - low latency, rich features.
 * Requires VPC connectivity to ElastiCache in Lambda environments.
 */
export class RedisCacheStore implements CacheStore {
  readonly name = 'redis';

  private clientPromise: Promise<Redis> | null = null;

  constructor(private readonly config: RedisCacheStoreConfig) {}

  async get<T>(key: string): Promise<T | undefined> {
    const client = await this.getClient();

    try {
      const value = await client.get(key);
      if (value === null) {
        return undefined;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn(`Redis get failed for ${key}`, error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const client = await this.getClient();

    try {
      await client.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.warn(`Redis set failed for ${key}`, error);
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.del(key);
    } catch (error) {
      logger.warn(`Redis delete failed for ${key}`, error);
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = await this.getClient();
    try {
      const keys = await client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      return client.del(...keys);
    } catch (error) {
      logger.warn(`Redis pattern delete failed for ${pattern}`, error);
      return 0;
    }
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      return (await client.exists(key)) === 1;
    } catch (error) {
      logger.warn(`Redis has check failed for ${key}`, error);
      return false;
    }
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.flushdb();
    } catch (error) {
      logger.warn('Redis clear failed', error);
    }
  }

  private async getClient(): Promise<Redis> {
    if (!this.clientPromise) {
      this.clientPromise = this.initClient();
    }
    return this.clientPromise;
  }

  private async initClient(): Promise<Redis> {
    const { default: RedisClient } = await import('ioredis');
    return new RedisClient(this.config.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      ...this.config.options,
    });
  }
}
