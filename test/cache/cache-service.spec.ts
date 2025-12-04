import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../../src/cache/cache-service.js';
import { MemoryCacheStore } from '../../src/cache/stores/memory-cache-store.js';
import { createCacheKey } from '../../src/cache/types.js';

describe('CacheService with MemoryCacheStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets and gets values with key prefix and default TTL', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 60, keyPrefix: 'demo' });

    await cache.set('user:1', { id: '1' });

    const value = await cache.get<{ id: string }>('user:1');
    expect(value).toEqual({ id: '1' });
    expect(await cache.has('user:1')).toBe(true);
    expect(await store.get('demo:user:1')).toBeDefined();
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 1 });

    await cache.set('temp', 'value');
    expect(await cache.get('temp')).toBe('value');

    vi.advanceTimersByTime(1_100);
    expect(await cache.get('temp')).toBeUndefined();
  });

  it('wrap caches computed values using default TTL', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 120 });

    const compute = vi.fn(async () => 'result');

    const first = await cache.wrap('key', undefined, compute);
    const second = await cache.wrap('key', undefined, compute);

    expect(first).toBe('result');
    expect(second).toBe('result');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('wrapSWR returns stale value and refreshes in background', async () => {
    vi.useFakeTimers();
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 300 });

    const fetchFn = vi.fn().mockResolvedValue('initial');

    const first = await cache.wrapSWR('swr-key', 1, 5, fetchFn);
    expect(first).toBe('initial');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_500); // stale but not expired
    fetchFn.mockResolvedValueOnce('refreshed');

    const stale = await cache.wrapSWR('swr-key', 1, 5, fetchFn);
    expect(stale).toBe('initial');

    // Allow background refresh to complete
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await cache.get('swr-key')).toBe('refreshed');
  });

  it('deletes by pattern with prefix applied', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 60, keyPrefix: 'svc' });

    await cache.set('user:1', 'a');
    await cache.set('user:2', 'b');
    await cache.set('other', 'c');

    const deleted = await cache.delByPattern('user:*');
    expect(deleted).toBe(2);
    expect(await cache.get('user:1')).toBeUndefined();
    expect(await cache.get('other')).toBe('c');
  });

  it('supports typed cache keys', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { defaultTTL: 60 });
    const userKey = createCacheKey<{ id: string }>('user', (id: string) => `user:${id}`);

    await cache.set(userKey('42'), { id: '42' });
    const value = await cache.get(userKey('42'));

    expect(value).toEqual({ id: '42' });
  });
});
