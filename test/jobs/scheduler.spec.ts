import { describe, expect, it, vi } from 'vitest';
import { createSchedulerHandler } from '../../src/jobs/scheduler.js';

const enqueueMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => {
  class DynamoDBClient {}
  return { DynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class QueryCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class DeleteCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  const send = vi.fn().mockResolvedValue({
    Items: [
      {
        pk: 'SCHEDULED#2025-01-01T00:00',
        sk: 'job-1',
        jobName: 'cleanup',
        payload: JSON.stringify({ id: 1 }),
        queue: 'default',
      },
    ],
  });
  const from = () => ({ send });
  return { QueryCommand, DeleteCommand, DynamoDBDocumentClient: { from }, send };
});

describe('createSchedulerHandler', () => {
  it('dispatches scheduled jobs to driver', async () => {
    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { enqueue: enqueueMock } as { enqueue: typeof enqueueMock },
    });

    await handler();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({
      jobName: 'cleanup',
      payload: { id: 1 },
      queue: 'default',
    });
  });
});
