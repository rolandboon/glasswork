import type { MiddlewareHandler } from 'hono';
import type { RateLimitOptions } from '../core/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Glasswork:RateLimit', true);

/**
 * In-memory rate limiter storage
 */
class MemoryStore {
  private store = new Map<
    string,
    {
      count: number;
      windowEnd: number;
    }
  >();

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

  // Cleanup expired entries periodically
  startCleanup(intervalMs = 60000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (item.windowEnd < now) {
          this.store.delete(key);
        }
      }
    }, intervalMs);
  }
}

/**
 * DynamoDB rate limiter storage
 */
class DynamoDBStore {
  private client: unknown;
  private tableName: string;

  constructor(tableName: string, region?: string) {
    this.tableName = tableName;
    // Lazy load AWS SDK only when needed
    this.initClient(region);
  }

  private async initClient(region?: string): Promise<void> {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

    const dynamoClient = new DynamoDBClient(region ? { region } : {});
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  async get(key: string): Promise<{ count: number; windowEnd: number } | null> {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = this.client as Awaited<ReturnType<typeof this.initClient>>;

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
    } catch {
      return null;
    }
  }

  async set(key: string, value: { count: number; windowEnd: number }): Promise<void> {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = this.client as Awaited<ReturnType<typeof this.initClient>>;

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
    const client = this.client as Awaited<ReturnType<typeof this.initClient>>;

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
 * Extract client IP from request context
 */
function getClientIdentifier(context: {
  req: { header: (name: string) => string | undefined };
}): string {
  // Check various headers for client IP
  const forwarded = context.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = context.req.header('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return 'unknown';
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
  }

  return async (context, next) => {
    const clientId = getClientIdentifier(context);
    const now = Date.now();
    const windowEnd = now + windowMs;

    const setHeaders = (remaining: number, resetMs: number): void => {
      context.header('RateLimit-Limit', String(maxRequests));
      context.header('RateLimit-Remaining', String(Math.max(0, remaining)));
      context.header('RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
    };

    try {
      const item = await store.get(clientId);

      // New window or expired
      if (!item) {
        await store.set(clientId, { count: 1, windowEnd });
        setHeaders(maxRequests - 1, windowMs);
        await next();
        return;
      }

      // Rate limit exceeded
      if (item.count >= maxRequests) {
        const retryMs = item.windowEnd - now;
        setHeaders(0, retryMs);
        context.header('Retry-After', String(Math.ceil(retryMs / 1000)));
        return context.json({ error: 'Too Many Requests' }, 429);
      }

      // Increment counter
      await store.increment(clientId);
      setHeaders(maxRequests - (item.count + 1), item.windowEnd - now);
      await next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Fail open - allow request
      setHeaders(maxRequests, windowMs);
      await next();
    }
  };
}
