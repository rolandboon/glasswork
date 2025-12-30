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

  it('skips items with missing required fields and continues processing', async () => {
    docSend.mockResolvedValueOnce({
      Items: [
        {
          pk: 'SCHEDULED#2025-01-01T00:00',
          // Missing jobName
          sk: 'job-1',
          payload: JSON.stringify({ id: 1 }),
        },
        {
          pk: 'SCHEDULED#2025-01-01T00:00',
          sk: 'job-2',
          jobName: 'valid-job',
          payload: JSON.stringify({ id: 2 }),
        },
      ],
    });

    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { name: 'mock', enqueue: enqueueMock } as {
        name: string;
        enqueue: typeof enqueueMock;
      },
    });

    const result = await handler();

    // Should only dispatch the valid job
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({
      jobName: 'valid-job',
    });
    expect(result).toEqual({ dispatched: 1 });
  });

  it('handles invalid JSON payloads gracefully and deletes malformed items', async () => {
    docSend.mockResolvedValueOnce({
      Items: [
        {
          pk: 'SCHEDULED#2025-01-01T00:00',
          sk: 'malformed-job',
          jobName: 'bad-payload-job',
          payload: 'not-valid-json{{{',
        },
      ],
    });

    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { name: 'mock', enqueue: enqueueMock } as {
        name: string;
        enqueue: typeof enqueueMock;
      },
    });

    const result = await handler();

    // Should not dispatch due to invalid payload
    expect(enqueueMock).not.toHaveBeenCalled();
    // Should delete the malformed item (second call after query)
    expect(docSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ dispatched: 0 });
  });

  it('handles undefined payload gracefully', async () => {
    docSend.mockResolvedValueOnce({
      Items: [
        {
          pk: 'SCHEDULED#2025-01-01T00:00',
          sk: 'no-payload-job',
          jobName: 'no-payload',
          // No payload field
        },
      ],
    });

    const handler = createSchedulerHandler({
      tableName: 'scheduled-jobs',
      region: 'us-east-1',
      driver: { name: 'mock', enqueue: enqueueMock } as {
        name: string;
        enqueue: typeof enqueueMock;
      },
    });

    const result = await handler();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({
      jobName: 'no-payload',
      payload: undefined,
    });
    expect(result).toEqual({ dispatched: 1 });
  });
});
