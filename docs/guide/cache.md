---
title: Cache
---

# Cache

Glasswork ships a Lambda-friendly cache abstraction with DynamoDB as the default store, Redis as a low-latency option, and an in-memory store for tests. The API is intentionally small: `get`, `set`, `del`, `wrap`, `wrapSWR`, `delByPattern`, and `has`.

## When to use it

- Reduce read load on downstream services or databases.
- Cache configuration and feature flags with short TTLs.
- Serve slightly stale data while refreshing in the background (stale-while-revalidate).

> For Lambda: avoid in-process `Map` caches—use DynamoDB (no VPC) or Redis (VPC).

## Installation

Cache stores are optional peer dependencies:

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb   # DynamoDB store
npm install ioredis                                         # Redis store (VPC)
```

## Core API

```typescript
import { CacheService, DynamoDBCacheStore, createCacheKey } from 'glasswork';

const store = new DynamoDBCacheStore({
  tableName: process.env.CACHE_TABLE!,
  region: process.env.AWS_REGION,
});

const cache = new CacheService(store, {
  defaultTTL: 300, // seconds
  keyPrefix: 'myapp', // optional namespace
});

const userKey = createCacheKey<{ id: string }>('user', (id: string) => `user:${id}`);

// Basic set/get
await cache.set(userKey('123'), { id: '123' }); // TTL defaults to 300
const user = await cache.get(userKey('123')); // -> { id: '123' } | undefined

// Cache-aside
const profile = await cache.wrap(userKey('123'), 600, () => fetchUser('123'));

// Stale-while-revalidate
const flags = await cache.wrapSWR('feature-flags', 60, 300, fetchFlags);
```

### TTLs and key prefixes

- `defaultTTL` is required and applies when `ttl` is omitted in `set`/`wrap`.
- Keys are automatically prefixed with `keyPrefix` when provided (`myapp:user:123`).

### Typed cache keys

`createCacheKey` attaches the expected type to the key factory, improving DX:

```typescript
const featureKey = createCacheKey<{ rollout: number }>('flags', () => 'flags:current');
const flags = await cache.get(featureKey); // typed as { rollout: number } | undefined
```

### Stale-while-revalidate (SWR)

`wrapSWR(key, staleTTL, maxTTL, fn)` returns cached data immediately. After `staleTTL`, it returns the stale value and refreshes in the background until `maxTTL` expires. Background refresh failures are logged but do not throw.

### Invalidation helpers

- `del(key)` removes a single entry.
- `delByPattern(pattern)` removes multiple entries when supported by the store (Redis). Patterns are prefixed automatically when `keyPrefix` is set.
- `has(key)` checks existence without loading the value when supported by the store.

## Stores

### DynamoDB (default, serverless)

```typescript
import { DynamoDBCacheStore } from 'glasswork';

const store = new DynamoDBCacheStore({
  tableName: 'my-cache',
  region: 'eu-central-1',
  endpoint: process.env.LOCALSTACK_ENDPOINT, // optional
});
```

**Table schema**

```yaml
CacheTable:
  Type: AWS::DynamoDB::Table
  Properties:
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

### Redis (low latency, VPC)

```typescript
import { RedisCacheStore } from 'glasswork';

const store = new RedisCacheStore({
  url: process.env.REDIS_URL!,
});
```

`delByPattern('*')` is supported for broad invalidation. Use cautiously in production.

### Memory (tests/local only)

```typescript
import { MemoryCacheStore, CacheService } from 'glasswork';

const store = new MemoryCacheStore();
const cache = new CacheService(store, { defaultTTL: 60 });
```

The memory store is not suitable for Lambda production use (no cross-invocation persistence).

## Module registration

Register the store and `CacheService` as providers in your module:

```typescript
import { defineModule, CacheService, DynamoDBCacheStore } from 'glasswork';

export const AppModule = defineModule({
  name: 'app',
  providers: [
    {
      provide: 'cacheStore',
      useFactory: () =>
        new DynamoDBCacheStore({
          tableName: process.env.CACHE_TABLE!,
          region: process.env.AWS_REGION,
        }),
    },
    {
      provide: CacheService,
      useFactory: ({ cacheStore }) =>
        new CacheService(cacheStore, {
          defaultTTL: 300,
          keyPrefix: 'app',
        }),
      inject: ['cacheStore'],
    },
    // other services...
  ],
  exports: [CacheService],
});
```

## Testing

Use `MemoryCacheStore` in unit tests:

```typescript
import { CacheService, MemoryCacheStore } from 'glasswork';

const cache = new CacheService(new MemoryCacheStore(), { defaultTTL: 120 });
```

`wrap` and `wrapSWR` are deterministic in tests (background refresh logs and continues). Use fake timers to simulate TTL expiry.
