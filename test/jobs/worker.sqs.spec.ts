import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../src/jobs/errors.js';
import type { JobDefinition } from '../../src/jobs/types.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  it('processes SQS job and calls hooks', async () => {
    const onJobStart = vi.fn();
    const onJobComplete = vi.fn();
    const increments: string[] = [];

    const job = defineJob({
      name: 'hello',
      schema: v.object({ name: v.string() }),
      handler: async (payload) => {
        increments.push(payload.name);
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job as JobDefinition<unknown>],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobStart, onJobComplete },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'hello',
        payload: { name: 'Alice' },
        jobId: 'job-1',
        enqueuedAt: new Date().toISOString(),
      }),
    });

    const result = await handler(event);

    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
    expect(onJobStart).toHaveBeenCalledTimes(1);
    expect(onJobComplete).toHaveBeenCalledTimes(1);
    expect(increments).toEqual(['Alice']);
  });

  it('marks permanent errors as dead letter without retry', async () => {
    const onDeadLetter = vi.fn();
    const job = defineJob({
      name: 'permanent',
      handler: () => {
        throw new PermanentJobError('no retry');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobDeadLetter: onDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'permanent',
        payload: {},
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    // PermanentJobError is now re-thrown for consistent error propagation,
    // so it will cause a batch failure (allowing SQS DLQ to capture it)
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('returns batch failure for transient errors', async () => {
    const job = defineJob({
      name: 'transient',
      handler: () => {
        throw new TransientJobError('retry later');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'transient',
        payload: {},
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(failures[0]?.itemIdentifier).toBe('msg-1');
  });

  it('retries invalid payloads so DLQ can capture them', async () => {
    const onDeadLetter = vi.fn();
    const job = defineJob({
      name: 'schema-job',
      schema: v.object({ name: v.string() }),
      handler: () => {
        // Will not be reached because payload is invalid
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job as JobDefinition<unknown>],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobDeadLetter: onDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'schema-job',
        payload: {}, // missing required name
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    // Should signal failure so SQS redrives to DLQ after retries
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(failures[0]?.itemIdentifier).toBe('msg-1');
    expect(onDeadLetter).not.toHaveBeenCalled();
  });
});
