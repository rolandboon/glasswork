import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  it('marks batch failure when payload cannot be parsed', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: 'not-json',
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];

    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('marks batch failure when payload is not an object', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: '"just-a-string"',
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('marks batch failure when job name is missing', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: JSON.stringify({
        payload: { data: 'test' },
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('throws for non-SQS invocation without job name', async () => {
    const job = defineJob({
      name: 'test',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    await expect(handler({ payload: {} })).rejects.toThrow(
      'Job name is required for non-SQS invocation'
    );
  });
});
