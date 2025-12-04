import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../utils/logger.js';
import type { CacheStore } from '../types.js';

const logger = createLogger('Glasswork:Cache:DynamoDB');

export interface DynamoDBCacheStoreConfig {
  /** DynamoDB table name. */
  tableName: string;
  /** AWS region. */
  region?: string;
  /** Custom endpoint (for LocalStack). */
  endpoint?: string;
}

/**
 * DynamoDB cache store - serverless, no VPC required.
 *
 * Table schema:
 * - pk (String): Cache key (partition key)
 * - value (String): JSON-serialized value
 * - expiresAt (Number): Unix timestamp for TTL
 */
export class DynamoDBCacheStore implements CacheStore {
  readonly name = 'dynamodb';

  private clientPromise: Promise<DynamoDBDocumentClient> | null = null;

  constructor(private readonly config: DynamoDBCacheStoreConfig) {}

  async get<T>(key: string): Promise<T | undefined> {
    const client = await this.getClient();
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

    try {
      const result = await client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk: key },
        })
      );

      if (!result.Item) {
        return undefined;
      }

      const expiresAt =
        typeof result.Item.expiresAt === 'number' ? result.Item.expiresAt : undefined;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt && expiresAt < now) {
        return undefined;
      }

      if (typeof result.Item.value !== 'string') {
        return undefined;
      }

      return JSON.parse(result.Item.value) as T;
    } catch (error) {
      logger.warn(`DynamoDB get failed for ${key}`, error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const client = await this.getClient();
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');

    const expiresAt = Math.floor(Date.now() / 1000) + ttl;

    try {
      await client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            pk: key,
            value: JSON.stringify(value),
            expiresAt,
          },
        })
      );
    } catch (error) {
      logger.warn(`DynamoDB set failed for ${key}`, error);
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    try {
      await client.send(
        new DeleteCommand({
          TableName: this.config.tableName,
          Key: { pk: key },
        })
      );
    } catch (error) {
      logger.warn(`DynamoDB delete failed for ${key}`, error);
    }
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient();
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

    try {
      const result = await client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk: key },
          ProjectionExpression: 'pk, expiresAt',
        })
      );

      if (!result.Item) {
        return false;
      }

      const expiresAt =
        typeof result.Item.expiresAt === 'number' ? result.Item.expiresAt : undefined;
      const now = Math.floor(Date.now() / 1000);
      return expiresAt === undefined || expiresAt >= now;
    } catch (error) {
      logger.warn(`DynamoDB has check failed for ${key}`, error);
      return false;
    }
  }

  private async getClient(): Promise<DynamoDBDocumentClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.initClient();
    }
    return this.clientPromise;
  }

  private async initClient(): Promise<DynamoDBDocumentClient> {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

    const baseClient = new DynamoDBClient({
      ...(this.config.region ? { region: this.config.region } : {}),
      ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
    });

    return DynamoDBDocumentClient.from(baseClient);
  }
}
