import type { MiddlewareHandler } from 'hono';
import type { RateLimitOptions } from '../core/types.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Glasswork:RateLimit');

/** Default cleanup interval for memory store (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

const memoryStores = new Set<MemoryStore>();
let shutdownHookRegistered = false;

interface ConsumeResult {
  allowed: boolean;
  count: number;
  windowEnd: number;
}

interface RateLimitStore {
  consume(key: string, windowEnd: number, maxRequests: number): Promise<ConsumeResult>;
}

/**
 * In-memory rate limiter storage.
 *
 * Includes automatic cleanup of expired entries to prevent memory leaks.
 * Call `stopCleanup()` when shutting down to clear the interval timer.
 */
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; windowEnd: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async consume(key: string, windowEnd: number, maxRequests: number): Promise<ConsumeResult> {
    const item = this.store.get(key);
    if (!item) {
      this.store.set(key, { count: 1, windowEnd });
      return { allowed: true, count: 1, windowEnd };
    }

    if (item.count >= maxRequests) {
      return { allowed: false, count: item.count, windowEnd: item.windowEnd };
    }

    item.count += 1;
    return { allowed: true, count: item.count, windowEnd: item.windowEnd };
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
class DynamoDBStore implements RateLimitStore {
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

  async consume(key: string, windowEnd: number, maxRequests: number): Promise<ConsumeResult> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await this.getClient();

    try {
      // @ts-expect-error - client type is complex
      const result = await client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { bucketId: key },
          UpdateExpression: 'SET #windowEnd = :windowEnd, #expiresAt = :expiresAt ADD #count :one',
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :maxRequests',
          ExpressionAttributeNames: {
            '#count': 'count',
            '#windowEnd': 'windowEnd',
            '#expiresAt': 'expiresAt',
          },
          ExpressionAttributeValues: {
            ':one': 1,
            ':maxRequests': maxRequests,
            ':windowEnd': windowEnd,
            ':expiresAt': Math.ceil(windowEnd / 1000),
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const count = Number(result.Attributes?.count ?? 1);
      return { allowed: true, count, windowEnd };
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return { allowed: false, count: maxRequests, windowEnd };
      }
      throw error;
    }
  }
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const { storage, windowMs = 60000, maxRequests = 100, dynamodb, keyGenerator } = options;

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('Rate limit windowMs must be greater than zero');
  }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error('Rate limit maxRequests must be a positive integer');
  }
  let store: RateLimitStore;
  if (storage === 'dynamodb') {
    if (!dynamodb?.tableName.trim()) {
      throw new Error('Rate limit DynamoDB storage requires dynamodb.tableName');
    }
    store = new DynamoDBStore(dynamodb.tableName, dynamodb.region);
  } else {
    store = new MemoryStore();
  }

  // Start cleanup for memory store
  if (store instanceof MemoryStore) {
    store.startCleanup();
    registerShutdownHook();
  }

  return async (context, next) => {
    const resolvedTrustProxy = options.trustProxy ?? context.get('trustProxy') === true;
    if (resolvedTrustProxy !== context.get('trustProxy')) {
      context.set('trustProxy', resolvedTrustProxy);
    }

    const now = Date.now();
    const windowNumber = Math.floor(now / windowMs);
    const windowEnd = (windowNumber + 1) * windowMs;

    const setHeaders = (remaining: number, resetMs: number): void => {
      context.header('RateLimit-Limit', String(maxRequests));
      context.header('RateLimit-Remaining', String(Math.max(0, remaining)));
      context.header('RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
    };

    // Rate limiting logic - fail open on errors
    let shouldBlock = false;
    let remaining = maxRequests;
    let resetMs = windowEnd - now;

    try {
      const clientId = keyGenerator ? await keyGenerator(context) : getClientIp(context);
      if (!clientId) throw new Error('Rate limit key generator returned an empty key');

      const result = await store.consume(`${clientId}:${windowNumber}`, windowEnd, maxRequests);
      shouldBlock = !result.allowed;
      remaining = Math.max(0, maxRequests - result.count);
      resetMs = Math.max(0, result.windowEnd - now);
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
