# Cache Module Development Plan for Glasswork

## Executive Summary

This document outlines the plan for a caching module in Glasswork. Since Lambda functions are ephemeral and don't maintain state between invocations, in-memory caching is ineffective. The module provides a simple caching abstraction with DynamoDB as the default store (Lambda-native, serverless) and Redis as an alternative for VPC-connected Lambdas.

## Background & Context

### The Lambda Caching Challenge

Unlike traditional servers, Lambda functions:
- Don't persist memory between invocations (cold starts)
- May run multiple concurrent instances (no shared state)
- Have limited execution time

This means in-memory caches like `node-cache` or simple `Map` objects are mostly useless—each invocation potentially starts fresh.

### Effective Lambda Cache Stores

| Store | Pros | Cons |
|-------|------|------|
| **DynamoDB** | Serverless, no VPC, pay-per-request, TTL built-in | Higher latency (~5-10ms), 400KB item limit |
| **ElastiCache (Redis)** | Fast (~1ms), rich data types, pub/sub | Requires VPC, always-on cost, more complex |
| **S3** | Large objects, cheap storage | Higher latency, not for small values |
| **DAX** | DynamoDB accelerator, microsecond latency | Requires VPC, additional cost |

### Framework Principles

1. **Lambda-First**: DynamoDB default (no VPC required)
2. **Transparency**: Simple store interface, bring your own store
3. **Great DX**: Easy to use, type-safe keys
4. **Minimal Dependencies**: Stores as peer dependencies

### Inspiration

- [NestJS Caching](https://docs.nestjs.com/techniques/caching) - Good abstraction, but decorator-heavy
- `cache-manager` - Popular Node.js caching abstraction

---

## Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Default Store** | DynamoDB | Serverless, no VPC, TTL built-in, pay-per-request |
| **Store Interface** | Simple get/set/del/wrap | Matches common caching patterns |
| **No Decorators** | Service methods only | Aligns with Glasswork's no-decorator philosophy |
| **TTL** | Required on set, configurable default | Prevents stale data accumulation |
| **Serialization** | JSON (configurable) | Simple, works for most use cases |
| **Package** | Part of core (small), stores as peer deps | Cache is fundamental; store implementations are optional |

---

## Architecture

### Cache Store Interface

```typescript
/**
 * Cache store interface - implement this for custom stores
 */
interface CacheStore {
  /** Store name for logging/debugging */
  readonly name: string;

  /**
   * Get a value from the cache
   * @returns The cached value or undefined if not found/expired
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache (must be JSON-serializable)
   * @param ttl - Time to live in seconds
   */
  set<T>(key: string, value: T, ttl: number): Promise<void>;

  /**
   * Delete a value from the cache
   */
  del(key: string): Promise<void>;

  /**
   * Delete multiple values by key pattern (if supported)
   * @returns Number of deleted keys, or undefined if not supported
   */
  delByPattern?(pattern: string): Promise<number | undefined>;

  /**
   * Check if a key exists (without retrieving the value)
   */
  has?(key: string): Promise<boolean>;

  /**
   * Clear all cached values (use with caution)
   */
  clear?(): Promise<void>;
}
```

### Cache Service

```typescript
/**
 * Cache service providing a simple caching API
 *
 * @example
 * ```typescript
 * // Basic usage
 * await cache.set('user:123', user, 3600); // Cache for 1 hour
 * const user = await cache.get<User>('user:123');
 *
 * // Using wrap (cache-aside pattern)
 * const user = await cache.wrap('user:123', 3600, async () => {
 *   return await userService.findById('123');
 * });
 * ```
 */
class CacheService {
  constructor(
    private store: CacheStore,
    private config: CacheConfig,
  ) {}

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | undefined> {
    const prefixedKey = this.prefixKey(key);
    return this.store.get<T>(prefixedKey);
  }

  /**
   * Set a cached value
   * @param ttl - Time to live in seconds (defaults to config.defaultTTL)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const effectiveTTL = ttl ?? this.config.defaultTTL;
    await this.store.set(prefixedKey, value, effectiveTTL);
  }

  /**
   * Delete a cached value
   */
  async del(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    await this.store.del(prefixedKey);
  }

  /**
   * Cache-aside pattern: get from cache or compute and cache
   *
   * @example
   * ```typescript
   * const user = await cache.wrap('user:123', 3600, async () => {
   *   return await db.user.findUnique({ where: { id: '123' } });
   * });
   * ```
   */
  async wrap<T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Cache-aside with stale-while-revalidate pattern
   *
   * Returns stale data immediately while refreshing in background.
   * Useful for data that can tolerate slight staleness.
   *
   * @param staleTTL - Time after which data is considered stale (but still usable)
   * @param maxTTL - Time after which data is completely expired
   */
  async wrapSWR<T>(
    key: string,
    staleTTL: number,
    maxTTL: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const entry = await this.getWithMetadata<T>(key);

    if (!entry) {
      // No cache, compute and store
      const value = await fn();
      await this.setWithMetadata(key, value, maxTTL);
      return value;
    }

    const age = Date.now() - entry.cachedAt;
    const isStale = age > staleTTL * 1000;

    if (isStale) {
      // Return stale value, refresh in background (fire-and-forget)
      this.refreshInBackground(key, maxTTL, fn);
    }

    return entry.value;
  }

  /**
   * Delete all keys matching a pattern
   * Note: Only supported by some stores (Redis)
   */
  async delByPattern(pattern: string): Promise<number | undefined> {
    if (!this.store.delByPattern) {
      return undefined;
    }
    const prefixedPattern = this.prefixKey(pattern);
    return this.store.delByPattern(prefixedPattern);
  }

  private prefixKey(key: string): string {
    return this.config.keyPrefix ? `${this.config.keyPrefix}:${key}` : key;
  }

  private async refreshInBackground<T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
  ): Promise<void> {
    try {
      const value = await fn();
      await this.set(key, value, ttl);
    } catch (error) {
      // Log but don't throw - we already returned stale data
      console.error(`[Cache] Background refresh failed for ${key}:`, error);
    }
  }
}

interface CacheConfig {
  /** Default TTL in seconds (default: 300 = 5 minutes) */
  defaultTTL: number;
  /** Key prefix for namespacing (default: none) */
  keyPrefix?: string;
}
```

---

## DynamoDB Store

The default store for Lambda environments:

```typescript
/**
 * DynamoDB cache store - serverless, no VPC required
 *
 * Table schema:
 * - pk (String): Cache key (partition key)
 * - value (String): JSON-serialized value
 * - expiresAt (Number): Unix timestamp for TTL
 *
 * @example
 * ```typescript
 * const store = new DynamoDBCacheStore({
 *   tableName: 'my-cache-table',
 *   region: 'eu-central-1',
 * });
 * ```
 */
class DynamoDBCacheStore implements CacheStore {
  readonly name = 'dynamodb';
  private client: DynamoDBDocumentClient | null = null;

  constructor(private config: DynamoDBCacheStoreConfig) {}

  private async getClient(): Promise<DynamoDBDocumentClient> {
    if (!this.client) {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

      const baseClient = new DynamoDBClient({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      });

      this.client = DynamoDBDocumentClient.from(baseClient);
    }
    return this.client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const client = await this.getClient();
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

    const result = await client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: { pk: key },
    }));

    if (!result.Item) {
      return undefined;
    }

    // Check if expired (DynamoDB TTL is eventually consistent)
    const now = Math.floor(Date.now() / 1000);
    if (result.Item.expiresAt && result.Item.expiresAt < now) {
      return undefined;
    }

    return JSON.parse(result.Item.value) as T;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const client = await this.getClient();
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');

    const expiresAt = Math.floor(Date.now() / 1000) + ttl;

    await client.send(new PutCommand({
      TableName: this.config.tableName,
      Item: {
        pk: key,
        value: JSON.stringify(value),
        expiresAt,
      },
    }));
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    await client.send(new DeleteCommand({
      TableName: this.config.tableName,
      Key: { pk: key },
    }));
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

    const result = await client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: { pk: key },
      ProjectionExpression: 'pk, expiresAt',
    }));

    if (!result.Item) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return !result.Item.expiresAt || result.Item.expiresAt >= now;
  }
}

interface DynamoDBCacheStoreConfig {
  /** DynamoDB table name */
  tableName: string;
  /** AWS region */
  region: string;
  /** Custom endpoint (for LocalStack) */
  endpoint?: string;
}
```

### DynamoDB Table (SAM Template)

```yaml
CacheTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub ${AWS::StackName}-cache
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: pk
        AttributeType: S
    KeySchema:
      - AttributeName: pk
        KeyType: HASH
    TimeToLiveSpecification:
      AttributeName: expiresAt
      Enabled: true
```

---

## Redis Store (Optional)

For users with VPC-connected Lambdas who need lower latency:

```typescript
/**
 * Redis cache store - low latency, rich features
 * Requires VPC connectivity to ElastiCache
 *
 * @example
 * ```typescript
 * const store = new RedisCacheStore({
 *   url: process.env.REDIS_URL,
 * });
 * ```
 */
class RedisCacheStore implements CacheStore {
  readonly name = 'redis';
  private client: Redis | null = null;

  constructor(private config: RedisCacheStoreConfig) {}

  private async getClient(): Promise<Redis> {
    if (!this.client) {
      const { Redis } = await import('ioredis');
      this.client = new Redis(this.config.url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 3000),
        ...this.config.options,
      });
    }
    return this.client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const client = await this.getClient();
    const value = await client.get(key);

    if (value === null) {
      return undefined;
    }

    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const client = await this.getClient();
    await client.setex(key, ttl, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(key);
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = await this.getClient();
    const keys = await client.keys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    return client.del(...keys);
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await client.exists(key)) === 1;
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    await client.flushdb();
  }
}

interface RedisCacheStoreConfig {
  /** Redis connection URL */
  url: string;
  /** Additional ioredis options */
  options?: Record<string, unknown>;
}
```

---

## Memory Store (Testing Only)

For unit tests and local development:

```typescript
/**
 * In-memory cache store - for testing only
 * NOT suitable for Lambda production use
 */
class MemoryCacheStore implements CacheStore {
  readonly name = 'memory';
  private cache = new Map<string, { value: string; expiresAt: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return JSON.parse(entry.value) as T;
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
        count++;
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
```

---

## Usage Examples

### Basic Caching

```typescript
// services/user.service.ts
class UserService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async findById(id: string): Promise<User | null> {
    // Try cache first
    const cached = await this.cache.get<User>(`user:${id}`);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (user) {
      // Cache for 5 minutes
      await this.cache.set(`user:${id}`, user, 300);
    }

    return user;
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    // Invalidate cache
    await this.cache.del(`user:${id}`);

    return user;
  }
}
```

### Using `wrap` (Cache-Aside Pattern)

```typescript
class UserService {
  async findById(id: string): Promise<User | null> {
    return this.cache.wrap(`user:${id}`, 300, async () => {
      return this.prisma.user.findUnique({ where: { id } });
    });
  }
}
```

### Using `wrapSWR` (Stale-While-Revalidate)

```typescript
class ConfigService {
  async getFeatureFlags(): Promise<FeatureFlags> {
    // Return stale data after 1 minute, refresh in background
    // Completely expire after 5 minutes
    return this.cache.wrapSWR('feature-flags', 60, 300, async () => {
      return this.fetchFeatureFlagsFromRemote();
    });
  }
}
```

### Module Registration

```typescript
// modules/app.module.ts
import { defineModule } from 'glasswork';
import { CacheService, DynamoDBCacheStore } from 'glasswork/cache';

export const AppModule = defineModule({
  name: 'app',
  providers: [
    // Register cache store
    {
      provide: 'cacheStore',
      useFactory: () => new DynamoDBCacheStore({
        tableName: process.env.CACHE_TABLE!,
        region: process.env.AWS_REGION!,
      }),
    },
    // Register cache service
    {
      provide: CacheService,
      useFactory: ({ cacheStore }) => new CacheService(cacheStore, {
        defaultTTL: 300,
        keyPrefix: 'myapp',
      }),
    },
    // Other services that depend on cache...
    UserService,
  ],
});
```

---

## Typed Cache Keys (Optional Enhancement)

For type-safe cache keys with autocomplete:

```typescript
// cache-keys.ts
import { createCacheKey } from 'glasswork/cache';

export const CacheKeys = {
  user: createCacheKey<User>('user', (id: string) => `user:${id}`),
  userList: createCacheKey<User[]>('user-list', () => 'users:list'),
  featureFlags: createCacheKey<FeatureFlags>('feature-flags', () => 'config:feature-flags'),
} as const;

// Usage
const user = await cache.get(CacheKeys.user('123'));
//    ^? User | undefined

await cache.set(CacheKeys.user('123'), user, 300);
//                                     ^? must be User
```

```typescript
// Implementation
function createCacheKey<T>(
  name: string,
  keyFn: (...args: any[]) => string,
): CacheKeyFactory<T> {
  return Object.assign(keyFn, { __type: undefined as T });
}

interface CacheKeyFactory<T> {
  (...args: any[]): string;
  __type: T;
}

// Overloaded cache methods
class CacheService {
  async get<T>(key: CacheKeyFactory<T>): Promise<T | undefined>;
  async get<T>(key: string): Promise<T | undefined>;
  async get<T>(key: string | CacheKeyFactory<T>): Promise<T | undefined> {
    const keyString = typeof key === 'function' ? key() : key;
    // ...
  }
}
```

---

## Testing

### Mock Store

```typescript
import { MemoryCacheStore, CacheService } from 'glasswork/cache';

describe('UserService', () => {
  let cache: CacheService;
  let userService: UserService;

  beforeEach(() => {
    const store = new MemoryCacheStore();
    cache = new CacheService(store, { defaultTTL: 300 });
    userService = new UserService(mockPrisma, cache);
  });

  it('should cache user after first fetch', async () => {
    const user = await userService.findById('123');

    // Second call should hit cache
    mockPrisma.user.findUnique.mockClear();
    const cachedUser = await userService.findById('123');

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(cachedUser).toEqual(user);
  });

  it('should invalidate cache on update', async () => {
    await userService.findById('123');
    await userService.update('123', { name: 'New Name' });

    // Should fetch from DB, not cache
    await userService.findById('123');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
```

---

## Dependencies

```json
{
  "peerDependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "@aws-sdk/client-dynamodb": { "optional": true },
    "@aws-sdk/lib-dynamodb": { "optional": true }
  },
  "optionalDependencies": {
    "ioredis": "^5.0.0"
  }
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
**Goal**: Basic caching with DynamoDB

**Deliverables**:
1. `CacheStore` interface
2. `CacheService` with `get`, `set`, `del`, `wrap`
3. `DynamoDBCacheStore` implementation
4. `MemoryCacheStore` for testing
5. SAM template snippet for cache table
6. Basic documentation

### Phase 2: Enhanced Features
**Goal**: Advanced caching patterns

**Deliverables**:
1. `wrapSWR` (stale-while-revalidate)
2. `delByPattern` support
3. `has` method
4. Typed cache keys (optional)
5. Metrics/logging hooks

### Phase 3: Redis Support
**Goal**: Alternative store for VPC users

**Deliverables**:
1. `RedisCacheStore` implementation
2. Connection pooling
3. Redis-specific features (pattern delete)
4. Documentation for ElastiCache setup

---

## Success Criteria

A successful cache module for Glasswork will:

1. ✅ Provide DynamoDB store as Lambda-native default
2. ✅ Have simple `get`/`set`/`del`/`wrap` API
3. ✅ Support TTL on all cached values
4. ✅ Include `MemoryCacheStore` for testing
5. ✅ Support Redis as alternative store
6. ✅ Follow Glasswork's transparency principle
7. ✅ Be easy to integrate with Awilix DI
8. ✅ Have comprehensive documentation

---

## Next Steps

1. **Phase 1**: Build core infrastructure with DynamoDB store
2. **Integration**: Add cache table to CLI infrastructure generation
3. **Document**: Write usage guides
4. **Phase 2**: Add enhanced features based on feedback

