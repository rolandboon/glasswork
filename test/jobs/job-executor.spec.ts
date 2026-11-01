import type { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { executeJob, type JobExecutionHooks } from '../../src/jobs/job-executor.js';
import { JobService } from '../../src/jobs/job-service.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import {
  getRequestContext,
  requestContextStorage,
} from '../../src/observability/request-context.js';
import { getTenantContext, runWithTenant } from '../../src/rls/context.js';
import { createLogger } from '../../src/utils/logger.js';

const silent = createLogger('test', 'silent');

/**
 * A feature module with a job that uses a private scoped provider with a disposer, and an
 * infrastructure module whose in-process driver resolves jobs through its own services.
 */
function application(options: { fail?: boolean; hooks?: JobExecutionHooks } = {}) {
  const events: string[] = [];
  let created = 0;
  const job = defineJob({
    name: 'export-report',
    retry: { maxAttempts: 3 },
    handler: async (_payload, { services }) => {
      const { reportState } = services as { reportState: { id: number } };
      events.push(`handler ${reportState.id}`);
      if (options.fail) throw new Error('export failed');
    },
  });
  const ReportsModule = defineModule({
    name: 'reports',
    providers: [
      {
        provide: 'reportState',
        scope: 'SCOPED',
        useFactory: () => ({ id: ++created }),
        dispose: (state: { id: number }) => {
          events.push(`dispose ${state.id}`);
        },
      },
    ],
    jobs: [job],
  });
  const JobsModule = defineModule({
    name: 'jobs',
    providers: [
      {
        provide: 'jobService',
        useFactory: (services: Record<string, unknown>) =>
          new JobService(
            new MockQueueDriver({
              executeImmediately: true,
              serviceResolver: () => services,
              logger: silent,
              hooks: options.hooks,
            })
          ),
      },
    ],
    exports: ['jobService'],
  });
  const AppModule: ModuleConfig = defineModule({
    name: 'app',
    imports: [ReportsModule, JobsModule],
  });
  return { AppModule, job, events };
}

function recordingHooks(events: string[]): JobExecutionHooks {
  return {
    onJobStart: (execution) => {
      events.push(`start attempt ${execution.attemptNumber}`);
    },
    onJobComplete: () => {
      events.push('complete');
    },
    onJobFailed: (_execution, _context, error) => {
      events.push(`failed: ${error.message}`);
    },
    onJobDeadLetter: () => {
      events.push('dead letter');
    },
  };
}

function sqsEvent(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: 'message-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify(body),
        attributes: { ApproximateReceiveCount: '1' },
        eventSourceARN: 'arn:aws:sqs:eu-west-1:000000000000:jobs',
      },
    ],
  } as unknown as SQSEvent;
}

async function runInProcess(options: { fail?: boolean }) {
  const events: string[] = [];
  const app = application({ ...options, hooks: recordingHooks(events) });
  const { container } = await bootstrap(app.AppModule, { environment: 'test' });
  const jobService = container.resolve<JobService>('jobService');
  const result = await jobService.enqueue(app.job, {}).then(
    () => 'acknowledged',
    (error: Error) => `rejected: ${error.message}`
  );
  return { events: [...events, ...app.events].sort(), result };
}

async function runInWorker(options: { fail?: boolean }) {
  const events: string[] = [];
  const app = application(options);
  const worker = bootstrapWorker({
    module: app.AppModule,
    hooks: recordingHooks(events),
    logger: silent,
    metrics: { enabled: false },
  });
  const response = await worker(sqsEvent({ jobName: 'export-report', payload: {} }));
  const result = response.batchItemFailures.length === 0 ? 'acknowledged' : 'redelivered';
  return { events: [...events, ...app.events].sort(), result };
}

describe('one executor for local and transport execution', () => {
  it('runs a job with the same hooks and a disposed scope in-process and in the worker', async () => {
    const local = await runInProcess({});
    const worker = await runInWorker({});

    const expected = ['complete', 'dispose 1', 'handler 1', 'start attempt 1'];
    expect(local).toEqual({ events: expected, result: 'acknowledged' });
    expect(worker).toEqual({ events: expected, result: 'acknowledged' });
  });

  it('disposes the scope and reports the same failure when the job fails', async () => {
    const local = await runInProcess({ fail: true });
    const worker = await runInWorker({ fail: true });

    const expected = ['dispose 1', 'failed: export failed', 'handler 1', 'start attempt 1'];
    expect(local).toEqual({ events: expected, result: 'rejected: export failed' });
    expect(worker).toEqual({ events: expected, result: 'redelivered' });
  });

  it('does not acknowledge a delivery whose failure hook throws', async () => {
    const app = application({ fail: true });
    const worker = bootstrapWorker({
      module: app.AppModule,
      logger: silent,
      metrics: { enabled: false },
      hooks: {
        onJobFailed: () => {
          throw new Error('hook failed');
        },
      },
    });

    const response = await worker(
      sqsEvent({ jobName: 'export-report', payload: {}, jobId: 'job-1' })
    );

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
    expect(app.events).toContain('dispose 1');
  });
});

describe('cleanup failures', () => {
  function moduleWith(options: { disposeFails?: boolean; jobFails?: boolean }) {
    const disposed: string[] = [];
    const job = defineJob({
      name: 'sync',
      handler: (_payload, { services }) => {
        void (services as { connection: object }).connection;
        if (options.jobFails) throw new Error('sync failed');
      },
    });
    const AppModule = defineModule({
      name: 'app',
      providers: [
        {
          provide: 'connection',
          scope: 'SCOPED',
          useFactory: () => ({}),
          dispose: () => {
            disposed.push('connection');
            if (options.disposeFails) throw new Error('close failed');
          },
        },
      ],
      jobs: [job],
    });
    return { AppModule, disposed };
  }

  it('does not acknowledge a successful job whose scope fails to close', async () => {
    const { AppModule, disposed } = moduleWith({ disposeFails: true });
    const worker = bootstrapWorker({ module: AppModule, logger: silent });

    const response = await worker(sqsEvent({ jobName: 'sync', payload: {} }));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
    expect(disposed).toEqual(['connection']);
  });

  it('disposes the scope and redelivers when the logger itself fails', async () => {
    const { AppModule, disposed } = moduleWith({ jobFails: true });
    const failingLogger = {
      ...silent,
      warn: () => {
        throw new Error('log sink unavailable');
      },
    };
    const worker = bootstrapWorker({ module: AppModule, logger: failingLogger });

    const response = await worker(sqsEvent({ jobName: 'sync', payload: {} }));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
    expect(disposed).toEqual(['connection']);
  });
});

describe('context of an execution', () => {
  function contextProbe() {
    const seen: Array<{ tenant?: string; requestId?: string }> = [];
    const job = defineJob({
      name: 'probe',
      handler: () => {
        seen.push({
          tenant: getTenantContext()?.tenantId,
          requestId: getRequestContext()?.requestId,
        });
      },
    });
    const AppModule = defineModule({ name: 'app', jobs: [job] });
    return { seen, job, AppModule };
  }

  it('does not inherit the tenant or request of the code that enqueues in-process', async () => {
    const { seen, job } = contextProbe();
    const jobService = new JobService(
      new MockQueueDriver({ executeImmediately: true, serviceResolver: () => ({}), logger: silent })
    );

    const result = await requestContextStorage.run(
      { requestId: 'request-1', method: 'POST', path: '/orders', custom: {} },
      () => runWithTenant({ tenantId: 'tenant-a' }, () => jobService.enqueue(job, {}))
    );

    expect(seen).toEqual([{ tenant: undefined, requestId: result.jobId }]);
  });

  it('uses the message correlation id as the request id of the execution', async () => {
    const { seen, AppModule } = contextProbe();
    const worker = bootstrapWorker({ module: AppModule, logger: silent });

    await worker(
      sqsEvent({
        jobName: 'probe',
        payload: {},
        jobId: 'job-7',
        metadata: { correlationId: 'request-9' },
      })
    );
    await worker(sqsEvent({ jobName: 'probe', payload: {}, jobId: 'job-8' }));

    expect(seen).toEqual([
      { tenant: undefined, requestId: 'request-9' },
      { tenant: undefined, requestId: 'job-8' },
    ]);
  });
});

describe('scope disposal at the execution boundary', () => {
  it('disposes an opened scope when binding a child logger throws', async () => {
    const failure = new Error('child logger unavailable');
    const dispose = vi.fn(async () => {});
    const result = await executeJob(
      { jobName: 'probe', jobId: 'j1', payload: {}, attemptNumber: 1, enqueuedAt: new Date() },
      {
        job: defineJob({ name: 'probe', handler: () => {} }),
        openScope: () => ({ services: {}, dispose }),
        overrideLogger: {
          ...silent,
          child: () => {
            throw failure;
          },
        },
        metrics: { enabled: false },
      }
    );
    expect(result).toEqual({ status: 'retry', error: failure });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('waits for every scoped disposer even when one fails first', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed = vi.fn();
    let disposing = false;
    const job = defineJob({
      name: 'cleanup',
      handler: (_payload, { services }) => {
        void services.fast;
        void services.slow;
      },
    });
    const module = defineModule({
      name: 'cleanup',
      jobs: [job],
      providers: [
        {
          provide: 'fast',
          scope: 'SCOPED',
          useFactory: () => ({}),
          dispose: () => {
            throw new Error('fast close failed');
          },
        },
        {
          provide: 'slow',
          scope: 'SCOPED',
          useFactory: () => ({}),
          dispose: async () => {
            disposing = true;
            await gate;
            closed();
          },
        },
      ],
    });
    const worker = bootstrapWorker({ module, logger: silent, metrics: { enabled: false } });
    let returned = false;
    const result = worker(sqsEvent({ jobName: 'cleanup', payload: {} })).then((value) => {
      returned = true;
      return value;
    });
    try {
      await vi.waitFor(() => expect(disposing).toBe(true));
      expect(returned).toBe(false);
    } finally {
      release();
      await result;
    }
    expect(closed).toHaveBeenCalledOnce();
    expect((await result).batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
  });
});
