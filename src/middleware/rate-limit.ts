import type { MiddlewareHandler } from 'hono';
import type { RateLimitOptions } from '../core/types.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Glasswork:RateLimit');

/** Default cleanup interval for memory store (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

const memoryStores = new Set<MemoryStore>();
let shutdownHookRegistered = false;

/**
 * In-memory rate limiter storage.
 *
 * Includes automatic cleanup of expired entries to prevent memory leaks.
 * Call `stopCleanup()` when shutting down to clear the interval timer.
 */
class MemoryStore {
  private store = new Map<
    string,
    {
      count: number;
      windowEnd: number;
    }
  >();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async get(key: string): Promise<{ count: number; windowEnd: number } | null> {
    const item = this.store.get(key);
    if (!item) {
      return null;
    }
    if (item.windowEnd < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item;
  }

  async set(key: string, value: { count: number; windowEnd: number }): Promise<void> {
    this.store.set(key, value);
  }

  async increment(key: string): Promise<void> {
    const item = this.store.get(key);
    if (item) {
      item.count += 1;
    }
  }

  /**
   * Start periodic cleanup of expired entries.
   * @param intervalMs - Cleanup interval in milliseconds (default: 60000)
   */
  startCleanup(intervalMs = DEFAULT_CLEANUP_INTERVAL_MS): void {
    // Clear any existing timer to prevent duplicates
    this.stopCleanup();

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (item.windowEnd < now) {
          this.store.delete(key);
        }
      }
    }, intervalMs);

    // Allow the event loop to exit even if the timer is scheduled (serverless)
    this.cleanupTimer.unref?.();

    memoryStores.add(this);
  }

  /**
   * Stop the cleanup timer.
   * Should be called when shutting down to prevent memory leaks in serverless environments.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    memoryStores.delete(this);
  }
}

/**
 * Stop cleanup timers for all in-memory rate limit stores.
 * Useful for graceful shutdown (e.g., serverless) and tests.
 */
export function stopAllRateLimitMemoryStores(): void {
  for (const store of memoryStores) {
    store.stopCleanup();
  }
  memoryStores.clear();
}

function registerShutdownHook(): void {
  if (shutdownHookRegistered) return;
  shutdownHookRegistered = true;
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.once('exit', () => {
      stopAllRateLimitMemoryStores();
    });
  }
}

/**
 * DynamoDB rate limiter storage.
 *
 * NOTE: This store "fails open" on errors - if DynamoDB is unavailable,
 * requests will be allowed through without rate limiting. This is intentional
 * to prevent DynamoDB issues from blocking all traffic, but means rate limiting
 * is not guaranteed during outages. Monitor DynamoDB errors in your logs.
 */
class DynamoDBStore {
  private clientPromise: Promise<unknown>;
  private tableName: string;

  constructor(tableName: string, region?: string) {
    this.tableName = tableName;
    // Initialize client lazily - Promise is stored and awaited on first use
    this.clientPromise = this.initClient(region);
  }

  private async initClient(region?: string): Promise<unknown> {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

    const dynamoClient = new DynamoDBClient(region ? { region } : {});
    return DynamoDBDocumentClient.from(dynamoClient);
  }

  /**
   * Get the initialized DynamoDB client, waiting for initialization if needed.
   */
  private async getClient(): Promise<unknown> {
    return this.clientPromise;
  }

  async get(key: string): Promise<{ count: number; windowEnd: number } | null> {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await this.getClient();

    try {
      // @ts-expect-error - client type is complex
      const { Item } = await client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { bucketId: key },
        })
      );

      if (!Item || Item.windowEnd < Date.now()) {
        return null;
      }

      return {
        count: Item.count,
        windowEnd: Item.windowEnd,
      };
    } catch (error) {
      // Log error but fail open to prevent DynamoDB issues from blocking traffic
      logger.error('DynamoDB rate limit get failed:', error);
      return null;
    }
  }

  async set(key: string, value: { count: number; windowEnd: number }): Promise<void> {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await this.getClient();

    const expiresAt = Math.floor(value.windowEnd / 1000);

    try {
      // @ts-expect-error - client type is complex
      await client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            bucketId: key,
            count: value.count,
            windowEnd: value.windowEnd,
            expiresAt,
          },
        })
      );
    } catch (error) {
      logger.error('DynamoDB rate limit set failed:', error);
    }
  }

  async increment(key: string): Promise<void> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await this.getClient();

    try {
      // @ts-expect-error - client type is complex
      await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { bucketId: key },
          UpdateExpression: 'SET #c = #c + :inc',
          ExpressionAttributeNames: { '#c': 'count' },
          ExpressionAttributeValues: { ':inc': 1 },
        })
      );
    } catch (error) {
      logger.error('DynamoDB rate limit increment failed:', error);
    }
  }
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const { storage, windowMs = 60000, maxRequests = 100, dynamodb } = options;

  // Create appropriate storage backend
  const store =
    storage === 'dynamodb' && dynamodb
      ? new DynamoDBStore(dynamodb.tableName, dynamodb.region)
      : new MemoryStore();

  // Start cleanup for memory store
  if (store instanceof MemoryStore) {
    store.startCleanup();
    registerShutdownHook();
  }

  return async (context, next) => {
    const clientId = getClientIp(context);
    const now = Date.now();
    const windowEnd = now + windowMs;

    const setHeaders = (remaining: number, resetMs: number): void => {
      context.header('RateLimit-Limit', String(maxRequests));
      context.header('RateLimit-Remaining', String(Math.max(0, remaining)));
      context.header('RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
    };

    // Rate limiting logic - fail open on errors
    let shouldBlock = false;
    let remaining = maxRequests - 1;
    let resetMs = windowMs;

    try {
      const item = await store.get(clientId);

      if (!item) {
        // New window or expired
        await store.set(clientId, { count: 1, windowEnd });
        remaining = maxRequests - 1;
        resetMs = windowMs;
      } else if (item.count >= maxRequests) {
        // Rate limit exceeded
        shouldBlock = true;
        remaining = 0;
        resetMs = item.windowEnd - now;
      } else {
        // Increment counter
        await store.increment(clientId);
        remaining = maxRequests - (item.count + 1);
        resetMs = item.windowEnd - now;
      }
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Fail open - allow request with default headers
      remaining = maxRequests;
      resetMs = windowMs;
    }

    setHeaders(remaining, resetMs);

    if (shouldBlock) {
      context.header('Retry-After', String(Math.ceil(resetMs / 1000)));
      return context.json({ error: 'Too Many Requests' }, 429);
    }

    await next();
  };
}
