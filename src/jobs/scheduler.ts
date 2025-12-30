import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import type { QueueDriver } from './types.js';

export interface SchedulerConfig {
  tableName: string;
  driver: QueueDriver;
  region: string;
  endpoint?: string;
  logger?: Logger;
}

interface ScheduledItem {
  pk: string;
  sk: string;
  jobName?: string;
  payload?: string;
  queue?: string;
}

interface ParsedScheduledJob {
  jobName: string;
  jobId: string;
  payload: unknown;
  queue: string;
}

/**
 * Parse a scheduled item from DynamoDB into a job dispatch payload.
 * Returns null if the item is invalid or malformed.
 */
function parseScheduledItem(item: ScheduledItem, logger: Logger): ParsedScheduledJob | null {
  const jobName = item.jobName;
  const jobId = item.sk;

  if (!jobName || !jobId) {
    logger.warn('Skipping scheduled item with missing required fields', {
      hasJobName: !!jobName,
      hasJobId: !!jobId,
    });
    return null;
  }

  let payload: unknown;
  try {
    payload = item.payload ? JSON.parse(item.payload) : undefined;
  } catch (error) {
    logger.error('Failed to parse scheduled job payload', { jobName, jobId, error });
    return null;
  }

  return {
    jobName,
    jobId,
    payload,
    queue: item.queue ?? 'default',
  };
}

/**
 * Create a scheduler handler that reads due jobs from DynamoDB and enqueues them.
 * Intended to be triggered periodically (e.g., every minute via EventBridge).
 */
export function createSchedulerHandler(config: SchedulerConfig) {
  const logger = config.logger ?? createLogger('JobScheduler');
  const ddbClient = new DynamoDBClient({
    region: config.region,
    ...(config.endpoint && { endpoint: config.endpoint }),
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  return async () => {
    const partition = `SCHEDULED#${new Date().toISOString().slice(0, 16)}`;

    const result = await docClient.send(
      new QueryCommand({
        TableName: config.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': partition },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return { dispatched: 0 };
    }

    let dispatched = 0;
    for (const item of result.Items) {
      const parsed = parseScheduledItem(item as ScheduledItem, logger);

      if (!parsed) {
        // Delete malformed items to prevent infinite retries
        if (item.sk) {
          await docClient.send(
            new DeleteCommand({
              TableName: config.tableName,
              Key: { pk: partition, sk: item.sk },
            })
          );
        }
        continue;
      }

      await config.driver.enqueue({
        jobName: parsed.jobName,
        payload: parsed.payload,
        queue: parsed.queue,
        jobId: parsed.jobId,
      });

      await docClient.send(
        new DeleteCommand({
          TableName: config.tableName,
          Key: { pk: partition, sk: parsed.jobId },
        })
      );

      dispatched += 1;
    }

    logger.info('Dispatched scheduled jobs', { dispatched });
    return { dispatched };
  };
}
