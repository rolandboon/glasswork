import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DynamoDBCacheStore', () => {
  const send = vi.fn(async (_command: unknown) => ({}));

  beforeEach(() => {
    vi.resetModules();
    send.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockAws = () => {
    vi.doMock('@aws-sdk/client-dynamodb', () => {
      class MockDynamoDBClient {
        constructor(public readonly options: unknown) {}
      }
      return { DynamoDBClient: MockDynamoDBClient };
    });

    vi.doMock('@aws-sdk/lib-dynamodb', () => {
      const MockDynamoDBDocumentClient = {
        from() {
          return { send };
        },
      };

      class MockGetCommand {
        constructor(public readonly input: unknown) {}
      }

      class MockPutCommand {
        constructor(public readonly input: unknown) {}
      }

      class MockDeleteCommand {
        constructor(public readonly input: unknown) {}
      }

      return {
        DynamoDBDocumentClient: MockDynamoDBDocumentClient,
        GetCommand: MockGetCommand,
        PutCommand: MockPutCommand,
        DeleteCommand: MockDeleteCommand,
      };
    });
  };

  it('stores and retrieves values with TTL enforcement', async () => {
    mockAws();
    const { DynamoDBCacheStore } = await import('../../src/cache/stores/dynamodb-cache-store.js');
    const store = new DynamoDBCacheStore({ tableName: 'cache', region: 'us-east-1' });

    send.mockResolvedValueOnce({}); // set
    await store.set('key', { foo: 'bar' }, 60);

    const putCommand = send.mock.calls[0][0] as { input: { Item: Record<string, unknown> } };
    expect(putCommand.input.Item.pk).toBe('key');
    expect(typeof putCommand.input.Item.expiresAt).toBe('number');

    send.mockResolvedValueOnce({
      Item: {
        pk: 'key',
        value: JSON.stringify({ foo: 'bar' }),
        expiresAt: Math.floor(Date.now() / 1000) + 10,
      },
    });

    const value = await store.get<{ foo: string }>('key');
    expect(value).toEqual({ foo: 'bar' });
  });

  it('returns undefined for expired entries and supports delete', async () => {
    mockAws();
    const { DynamoDBCacheStore } = await import('../../src/cache/stores/dynamodb-cache-store.js');
    const store = new DynamoDBCacheStore({ tableName: 'cache' });

    send.mockResolvedValueOnce({
      Item: {
        pk: 'key',
        value: JSON.stringify('stale'),
        expiresAt: Math.floor(Date.now() / 1000) - 10,
      },
    });

    expect(await store.get('key')).toBeUndefined();

    send.mockResolvedValueOnce({});
    await store.del('key');
    const deleteCommand = send.mock.calls.at(-1)?.[0] as {
      input: { Key: Record<string, unknown> };
    };
    expect(deleteCommand.input.Key.pk).toBe('key');
  });

  it('checks existence using projection', async () => {
    mockAws();
    const { DynamoDBCacheStore } = await import('../../src/cache/stores/dynamodb-cache-store.js');
    const store = new DynamoDBCacheStore({ tableName: 'cache' });

    send.mockResolvedValueOnce({
      Item: {
        pk: 'key',
        expiresAt: Math.floor(Date.now() / 1000) + 5,
      },
    });

    expect(await store.has('key')).toBe(true);
  });
});

describe('RedisCacheStore', () => {
  const clientMethods = {
    get: vi.fn(async (_key: string) => null as string | null),
    setex: vi.fn(async (_key: string, _ttl: number, _value: string) => 'OK'),
    del: vi.fn(async (..._keys: string[]) => 0),
    keys: vi.fn(async (_pattern: string) => [] as string[]),
    exists: vi.fn(async (_key: string) => 0),
    flushdb: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.resetModules();
    Object.values(clientMethods).forEach((fn) => {
      fn.mockReset();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockRedis = () => {
    vi.doMock(
      'ioredis',
      () => {
        class MockRedis {
          get = clientMethods.get;
          setex = clientMethods.setex;
          del = clientMethods.del;
          keys = clientMethods.keys;
          exists = clientMethods.exists;
          flushdb = clientMethods.flushdb;

          constructor(
            public readonly url: string,
            public readonly options?: unknown
          ) {}
        }

        return { default: MockRedis };
      },
      { virtual: true }
    );
  };

  it('sets and retrieves values', async () => {
    mockRedis();
    const { RedisCacheStore } = await import('../../src/cache/stores/redis-cache-store.js');
    const store = new RedisCacheStore({ url: 'redis://localhost' });

    clientMethods.setex.mockResolvedValueOnce(undefined);
    clientMethods.get.mockResolvedValueOnce(JSON.stringify({ foo: 'bar' }));

    await store.set('key', { foo: 'bar' }, 30);
    expect(clientMethods.setex).toHaveBeenCalledWith('key', 30, JSON.stringify({ foo: 'bar' }));

    const value = await store.get<{ foo: string }>('key');
    expect(value).toEqual({ foo: 'bar' });
  });

  it('deletes by pattern and clears cache', async () => {
    mockRedis();
    const { RedisCacheStore } = await import('../../src/cache/stores/redis-cache-store.js');
    const store = new RedisCacheStore({ url: 'redis://localhost' });

    clientMethods.keys.mockResolvedValueOnce(['a', 'b']);
    clientMethods.del.mockResolvedValueOnce(2);
    const deleted = await store.delByPattern('*');
    expect(deleted).toBe(2);

    clientMethods.flushdb.mockResolvedValueOnce();
    await store.clear();
    expect(clientMethods.flushdb).toHaveBeenCalled();
  });

  it('checks for key existence', async () => {
    mockRedis();
    const { RedisCacheStore } = await import('../../src/cache/stores/redis-cache-store.js');
    const store = new RedisCacheStore({ url: 'redis://localhost' });

    clientMethods.exists.mockResolvedValueOnce(1);
    expect(await store.has('present')).toBe(true);
  });
});
