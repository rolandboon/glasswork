import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSchedulerHandler } from '../../src/jobs/scheduler.js';

const enqueueMock = vi.fn();
const scheduledItems = {
  Items: [
    {
      pk: 'SCHEDULED#2025-01-01T00:00',
      sk: 'job-1',
      jobName: 'cleanup',
      payload: JSON.stringify({ id: 1 }),
      queue: 'default',
    },
  ],
};
const docSend = vi.fn().mockResolvedValue(scheduledItems);

beforeEach(() => {
  enqueueMock.mockReset();
  docSend.mockReset();
  docSend.mockResolvedValue(scheduledItems);
});

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
  const from = () => ({ send: docSend });
  return { QueryCommand, DeleteCommand, DynamoDBDocumentClient: { from } };
});

describe('createSchedulerHandler', () => {
  it('dispatches scheduled jobs to driver', async () => {
    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { name: 'mock', enqueue: enqueueMock } as {
        name: string;
        enqueue: typeof enqueueMock;
      },
    });

    await handler();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({
      jobName: 'cleanup',
      payload: { id: 1 },
      queue: 'default',
    });
  });

  it('returns zero when nothing is scheduled', async () => {
    docSend.mockResolvedValueOnce({ Items: [] });

    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { name: 'mock', enqueue: enqueueMock } as {
        name: string;
        enqueue: typeof enqueueMock;
      },
    });

    const result = await handler();

    expect(result).toEqual({ dispatched: 0 });
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
