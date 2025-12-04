import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AuthSession } from './types.js';

export interface DynamoDBSessionConfig {
  /** DynamoDB table name. */
  tableName: string;
  /** AWS region. */
  region?: string;
  /** Custom endpoint (for LocalStack). */
  endpoint?: string;
  /** Session TTL in seconds (default: 7 days). */
  sessionTTL?: number;
  /** Inject an existing DocumentClient (useful for testing). */
  documentClient?: DynamoDBDocumentClient;
}

export interface DynamoDBSessionRecord extends AuthSession {
  data?: Record<string, unknown>;
}

/**
 * DynamoDB session adapter for better-auth.
 * Optimized for Lambda with lazy client initialization.
 */
export function createDynamoDBSessionAdapter(config: DynamoDBSessionConfig) {
  let client = config.documentClient ?? null;

  async function getClient(): Promise<DynamoDBDocumentClient> {
    if (client) return client;

    try {
      const [{ DynamoDBClient }, { DynamoDBDocumentClient }] = await Promise.all([
        import('@aws-sdk/client-dynamodb'),
        import('@aws-sdk/lib-dynamodb'),
      ]);

      const baseClient = new DynamoDBClient({
        ...(config.region && { region: config.region }),
        ...(config.endpoint && { endpoint: config.endpoint }),
      });

      client = DynamoDBDocumentClient.from(baseClient);
      return client;
    } catch (_error) {
      throw new Error(
        'AWS SDK packages are required for the DynamoDB session adapter. ' +
          'Install @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb.'
      );
    }
  }

  return {
    async createSession(session: {
      id: string;
      userId: string;
      expiresAt: Date;
      data?: Record<string, unknown>;
    }): Promise<DynamoDBSessionRecord> {
      const ddb = await getClient();
      const expiresAtTimestamp = Math.floor(session.expiresAt.getTime() / 1000);

      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');

      await ddb.send(
        new PutCommand({
          TableName: config.tableName,
          Item: {
            pk: session.id,
            userId: session.userId,
            data: JSON.stringify(session.data ?? {}),
            expiresAt: expiresAtTimestamp,
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
          },
        })
      );

      return {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        createdAt: new Date(),
        metadata: session.data,
      };
    },

    async getSession(sessionId: string): Promise<DynamoDBSessionRecord | null> {
      const ddb = await getClient();
      const { GetCommand } = await import('@aws-sdk/lib-dynamodb');

      const result = await ddb.send(
        new GetCommand({
          TableName: config.tableName,
          Key: { pk: sessionId },
        })
      );

      if (!result.Item) {
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      if ((result.Item as { expiresAt?: number }).expiresAt && result.Item.expiresAt < now) {
        return null;
      }

      const dataString = (result.Item as { data?: string }).data || '{}';
      let parsedData: Record<string, unknown> = {};
      try {
        parsedData = JSON.parse(dataString);
      } catch {
        parsedData = {};
      }

      return {
        id: String((result.Item as { pk: string }).pk),
        userId: String((result.Item as { userId: string }).userId),
        expiresAt: new Date(Number((result.Item as { expiresAt: number }).expiresAt) * 1000),
        createdAt: new Date((result.Item as { createdAt: string }).createdAt),
        lastAccessedAt: (result.Item as { lastAccessedAt?: string }).lastAccessedAt
          ? new Date((result.Item as { lastAccessedAt: string }).lastAccessedAt)
          : undefined,
        metadata: parsedData,
        data: parsedData,
      };
    },

    async updateSession(
      sessionId: string,
      data: Partial<{ expiresAt: Date; data: Record<string, unknown> }>
    ): Promise<void> {
      const ddb = await getClient();
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

      const updateExpressions = ['lastAccessedAt = :lastAccessedAt'];
      const expressionValues: Record<string, unknown> = {
        ':lastAccessedAt': new Date().toISOString(),
      };
      const expressionNames: Record<string, string> = {};

      if (data.expiresAt) {
        updateExpressions.push('expiresAt = :expiresAt');
        expressionValues[':expiresAt'] = Math.floor(data.expiresAt.getTime() / 1000);
      }

      if (data.data) {
        updateExpressions.push('#data = :data');
        expressionValues[':data'] = JSON.stringify(data.data);
        expressionNames['#data'] = 'data';
      }

      await ddb.send(
        new UpdateCommand({
          TableName: config.tableName,
          Key: { pk: sessionId },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeValues: expressionValues,
          ...(Object.keys(expressionNames).length > 0
            ? { ExpressionAttributeNames: expressionNames }
            : {}),
        })
      );
    },

    async deleteSession(sessionId: string): Promise<void> {
      const ddb = await getClient();
      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

      await ddb.send(
        new DeleteCommand({
          TableName: config.tableName,
          Key: { pk: sessionId },
        })
      );
    },
  };
}
