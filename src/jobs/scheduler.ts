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

/**
 * Create a scheduler handler that reads due jobs from DynamoDB and enqueues them.
 * Intended to be triggered every minute (e.g., with EventBridge Scheduler).
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
      const jobName = item.jobName as string;
      const payload = JSON.parse(item.payload as string);
      const queue = (item.queue as string) ?? 'default';
      const jobId = item.sk as string;

      await config.driver.enqueue({
        jobName,
        payload,
        queue,
        jobId,
      });

      await docClient.send(
        new DeleteCommand({
          TableName: config.tableName,
          Key: { pk: partition, sk: jobId },
        })
      );

      dispatched += 1;
    }

    logger.info({ dispatched }, 'Dispatched scheduled jobs');
    return { dispatched };
  };
}
