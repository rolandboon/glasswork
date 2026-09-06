import * as v from 'valibot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../../src/core/module.js';
import { defineJob } from '../../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../../src/jobs/errors.js';
import type { EMFJobMetricRecord } from '../../../src/jobs/observability/types.js';
import type { JobDefinition } from '../../../src/jobs/types.js';
import { bootstrapWorker } from '../../../src/jobs/worker.js';
import { createLogger } from '../../../src/utils/logger.js';
import { buildSqsEvent } from '../../helpers/sqs.js';

function captureMetrics() {
  const records: EMFJobMetricRecord[] = [];
  const sink = vi.fn((line: string) => {
    records.push(JSON.parse(line));
  });
  return { records, sink };
}
function event(attemptNumber = 1) {
  return buildSqsEvent({
    body: JSON.stringify({
      jobName: 'test-job',
      jobId: 'job-101',
      payload: {},
      enqueuedAt: new Date(Date.now() - 500).toISOString(),
    }),
    ApproximateReceiveCount: `${attemptNumber}`,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('worker EMF integration', () => {
  it('emits one sample after a successful handler and completion hook', async () => {
    const { sink, records } = captureMetrics();
    const completed = vi.fn();
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [defineJob({ name: 'test-job', handler: completed })],
      }),
      hooks: {
        onJobComplete: () => {
          expect(sink).not.toHaveBeenCalled();
        },
      },
      metrics: { namespace: 'Test/Jobs', sink },
    });
    expect(await handler(event())).toEqual({ batchItemFailures: [] });
    expect(completed).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      JobName: 'test-job',
      JobId: 'job-101',
      Status: 'success',
      AttemptNumber: 1,
      JobCount: 1,
      JobErrorCount: 0,
      RetryCount: 0,
      DeadLetterCount: 0,
    });
    expect(records[0].JobDuration).toBeGreaterThanOrEqual(0);
    expect(records[0].QueueWaitTime).toBeGreaterThanOrEqual(400);
    expect(records[0]._aws.CloudWatchMetrics[0].Namespace).toBe('Test/Jobs');
  });

  it.each([
    {
      retry: { maxAttempts: 3 },
      attempt: 1,
      error: new TransientJobError('private@example.com'),
      status: 'retry',
      rejected: true,
    },
    {
      retry: { maxAttempts: 3 },
      attempt: 3,
      error: new Error('secret'),
      status: 'dead_letter',
      rejected: true,
    },
    {
      retry: false as const,
      attempt: 1,
      error: new Error('secret'),
      status: 'failed',
      rejected: false,
    },
    {
      retry: { maxAttempts: 2, dead: false },
      attempt: 2,
      error: new Error('secret'),
      status: 'failed',
      rejected: false,
    },
    {
      retry: false as const,
      attempt: 1,
      error: new PermanentJobError('secret'),
      status: 'dead_letter',
      rejected: true,
    },
  ])(
    'reports $status at attempt $attempt with retry=$retry',
    async ({ retry, attempt, error, status, rejected }) => {
      const { sink, records } = captureMetrics();
      const handler = bootstrapWorker({
        module: defineModule({
          name: 'worker',
          jobs: [
            defineJob({
              name: 'test-job',
              retry,
              handler: () => {
                throw error;
              },
            }),
          ],
        }),
        metrics: { sink },
      });
      expect(await handler(event(attempt))).toEqual({
        batchItemFailures: rejected ? [{ itemIdentifier: 'msg-1' }] : [],
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        Status: status,
        JobErrorCount: 1,
        RetryCount: attempt > 1 ? 1 : 0,
      });
      expect(JSON.stringify(records)).not.toMatch(/secret|private@example|ErrorStack|ErrorMessage/);
    }
  );

  it.each(['onJobStart', 'onJobComplete'] as const)(
    'counts a failing %s hook once as a failure',
    async (hook) => {
      const { sink, records } = captureMetrics();
      const handler = bootstrapWorker({
        module: defineModule({
          name: 'worker',
          jobs: [defineJob({ name: 'test-job', handler: () => {} })],
        }),
        hooks: {
          [hook]: () => {
            throw new Error('hook failed');
          },
        },
        metrics: { sink },
      });
      expect(await handler(event())).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ Status: 'retry', JobCount: 1, JobErrorCount: 1 });
    }
  );

  it('measures payload validation failures without executing the handler', async () => {
    const { sink, records } = captureMetrics();
    const execute = vi.fn();
    const job = defineJob({
      name: 'test-job',
      schema: v.object({ required: v.string() }),
      handler: execute,
    });
    const handler = bootstrapWorker({
      module: defineModule({ name: 'worker', jobs: [job as JobDefinition<unknown>] }),
      metrics: { sink },
    });
    expect(await handler(event())).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    expect(execute).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0].Status).toBe('retry');
  });

  it('reports a scoped provider resolution failure as one failed attempt', async () => {
    const { sink, records } = captureMetrics();
    const resolve = vi.fn(() => {
      expect(sink).not.toHaveBeenCalled();
      throw new Error('resource unavailable');
    });
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        providers: [{ provide: 'resource', useFactory: resolve, scope: 'SCOPED' }],
        jobs: [
          defineJob({
            name: 'test-job',
            handler: (_payload, context) => {
              void context.services.resource;
            },
          }),
        ],
      }),
      metrics: { sink },
    });
    expect(await handler(event())).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    expect(resolve).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ Status: 'retry', JobErrorCount: 1 });
  });

  it.each([false, true])(
    'does not change batch acknowledgements when a sink fails (job failure=%s)',
    async (fail) => {
      const logger = createLogger('test', 'silent');
      const warn = vi.spyOn(logger, 'warn');
      const handler = bootstrapWorker({
        module: defineModule({
          name: 'worker',
          jobs: [
            defineJob({
              name: 'test-job',
              handler: () => {
                if (fail) throw new Error('original job failure');
              },
            }),
          ],
        }),
        logger,
        metrics: {
          sink: () => {
            throw new Error('metric sink failure');
          },
        },
      });
      expect(await handler(event())).toEqual({
        batchItemFailures: fail ? [{ itemIdentifier: 'msg-1' }] : [],
      });
      expect(warn).toHaveBeenCalledWith('Failed to emit job metrics', { jobName: 'test-job' });
    }
  );

  it('preserves the original error for non-SQS invocations when metrics fail', async () => {
    const failure = new Error('original');
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [
          defineJob({
            name: 'test-job',
            handler: () => {
              throw failure;
            },
          }),
        ],
      }),
      metrics: {
        sink: () => {
          throw new Error('sink');
        },
      },
    });
    await expect(handler({ jobName: 'test-job' })).rejects.toBe(failure);
  });

  it('keeps telemetry and warning logger failures from retrying successful jobs', async () => {
    const logger = createLogger('test', 'silent');
    logger.warn = () => {
      throw new Error('logger failure');
    };
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [defineJob({ name: 'test-job', handler: () => {} })],
      }),
      logger,
      metrics: { dimensions: { JobId: 'forbidden' }, sink: vi.fn() },
    });
    expect(await handler(event())).toEqual({ batchItemFailures: [] });
  });

  it('emits for successful non-SQS invocations', async () => {
    const { sink, records } = captureMetrics();
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [defineJob({ name: 'test-job', handler: () => {} })],
      }),
      metrics: { sink },
    });
    expect(await handler({ detail: { jobName: 'test-job', payload: {} } })).toEqual({
      success: true,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ JobName: 'test-job', Status: 'success', AttemptNumber: 1 });
  });

  it('emits once per record in a mixed batch without changing partial failures', async () => {
    const { sink, records } = captureMetrics();
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [
          defineJob<{ fail: boolean }>({
            name: 'test-job',
            handler: (payload) => {
              if (payload.fail) throw new Error('retry');
            },
          }),
        ],
      }),
      metrics: { sink },
    });
    const batch = {
      Records: [false, true, false].map(
        (fail, n) =>
          buildSqsEvent({
            messageId: `msg-${n}`,
            body: JSON.stringify({ jobName: 'test-job', payload: { fail } }),
          }).Records[0]
      ),
    };
    expect(await handler(batch)).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    expect(records.map(({ Status }) => Status)).toEqual(['success', 'retry', 'success']);
  });

  it('does not turn malformed envelopes or unknown job names into metric dimensions', async () => {
    const { sink } = captureMetrics();
    const handler = bootstrapWorker({
      module: defineModule({ name: 'worker' }),
      metrics: { sink },
    });
    for (const body of ['not-json', '{}', '{"jobName":"private@example.com"}']) {
      expect(await handler(buildSqsEvent({ body }))).toEqual({
        batchItemFailures: [{ itemIdentifier: 'msg-1' }],
      });
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it('still executes and calls lifecycle hooks with metrics disabled', async () => {
    const { sink } = captureMetrics();
    const execute = vi.fn();
    const completed = vi.fn();
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'worker',
        jobs: [defineJob({ name: 'test-job', handler: execute })],
      }),
      hooks: { onJobComplete: completed },
      metrics: { enabled: false, sink },
    });
    expect(await handler(event())).toEqual({ batchItemFailures: [] });
    expect(execute).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
    expect(sink).not.toHaveBeenCalled();
  });
});
