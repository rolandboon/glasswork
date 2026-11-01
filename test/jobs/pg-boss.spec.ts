import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrapRuntime } from '../../src/core/bootstrap-runtime.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { PgBossQueueDriver } from '../../src/jobs/drivers/pg-boss-driver.js';
import { PermanentJobError } from '../../src/jobs/errors.js';
import type { JobExecutionHooks } from '../../src/jobs/job-executor.js';
import { JobService } from '../../src/jobs/job-service.js';
import { createPgBossWorker } from '../../src/jobs/pg-boss-worker.js';
import type { AnyJobDefinition } from '../../src/jobs/types.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/utils/logger.js';

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const [major, minor] = process.versions.node.split('.').map(Number);
// pg-boss 12 requires Node.js 22.12 or later.
const supported = (major ?? 0) > 22 || (major === 22 && (minor ?? 0) >= 12);
const silent = createLogger('test', 'silent');
const schema = `pgboss_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const bosses: PgBoss[] = [];

async function startBoss(options: { supervise?: boolean } = {}) {
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    supervise: options.supervise ?? false,
    superviseIntervalSeconds: 1,
    schedule: false,
  });
  boss.on('error', () => {});
  await boss.start();
  bosses.push(boss);
  return boss;
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await sleep(50);
  }
}

/** A module whose job uses a private scoped provider, and the runtime around it. */
async function application(job: AnyJobDefinition) {
  const events: string[] = [];
  let created = 0;
  const ReportsModule: ModuleConfig = defineModule({
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
  const runtime = await bootstrapRuntime(defineModule({ name: 'app', imports: [ReportsModule] }), {
    environment: 'test',
    logger: { instance: silent },
  });
  return { container: runtime.container, events, module: ReportsModule };
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

describe.skipIf(!databaseUrl || !supported)('pg-boss driver and worker', () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = await startBoss();
    for (const queue of ['default', 'retries', 'dead', 'pair', 'crash', 'drain', 'tx']) {
      await boss.createQueue(queue, queue === 'crash' ? { expireInSeconds: 1 } : {});
    }
  });

  afterAll(async () => {
    for (const instance of bosses.splice(0)) await instance.stop({ graceful: false });
    const client = new pg.Client(databaseUrl);
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it('runs a job definition with the same scope, hooks and outcome as the SQS worker', async () => {
    const exportReport = () => {
      const events: string[] = [];
      const job = defineJob({
        name: 'export-report',
        handler: (_payload, { services }) => {
          events.push(`handler ${(services.reportState as { id: number }).id}`);
        },
      });
      return { job, events };
    };

    const viaPgBoss = exportReport();
    const pgBossApp = await application(viaPgBoss.job);
    const worker = createPgBossWorker({
      boss,
      container: pgBossApp.container,
      queues: ['default'],
      pollingIntervalSeconds: 0.5,
      hooks: recordingHooks(viaPgBoss.events),
      logger: silent,
    });
    await worker.start();
    await new JobService(new PgBossQueueDriver({ boss })).enqueue(viaPgBoss.job, {});
    await waitFor(() => pgBossApp.events.includes('dispose 1'));
    await worker.stop();

    const viaSqs = exportReport();
    const sqsApp = await application(viaSqs.job);
    const sqsWorker = bootstrapWorker({
      module: defineModule({ name: 'sqs-app', imports: [sqsApp.module] }),
      hooks: recordingHooks(viaSqs.events),
      logger: silent,
      metrics: { enabled: false },
    });
    const response = await sqsWorker({
      Records: [
        {
          messageId: 'message-1',
          receiptHandle: 'receipt-1',
          body: JSON.stringify({ jobName: 'export-report', payload: {} }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    } as never);

    const expected = ['complete', 'dispose 1', 'handler 1', 'start attempt 1'];
    expect([...viaPgBoss.events, ...pgBossApp.events].sort()).toEqual(expected);
    expect([...viaSqs.events, ...sqsApp.events].sort()).toEqual(expected);
    expect(response).toEqual({ batchItemFailures: [] });
  });

  it('retries with the attempt number and dead-letters the job after its last attempt', async () => {
    const job = defineJob({
      name: 'sync-ledger',
      queue: 'retries',
      retry: { maxAttempts: 2 },
      handler: () => {
        throw new Error('ledger unavailable');
      },
    });
    const { container, events } = await application(job);
    const worker = createPgBossWorker({
      boss,
      container,
      queues: ['retries'],
      pollingIntervalSeconds: 0.5,
      hooks: recordingHooks(events),
      logger: silent,
    });
    await worker.start();
    const driver = new PgBossQueueDriver({ boss, deadLetterQueue: 'dead', retryDelaySeconds: 0 });

    const { jobId } = await new JobService(driver).enqueue(job, {});
    const dead = await waitForDeadLetter(boss, jobId);
    await worker.stop();

    expect(dead).toMatchObject({ jobName: 'sync-ledger', jobId });
    expect(events.filter((event) => event.startsWith('start'))).toEqual([
      'start attempt 1',
      'start attempt 2',
    ]);
    expect(events.filter((event) => event === 'dead letter')).toHaveLength(1);
  });

  it('dead-letters a permanent failure at once', async () => {
    const job = defineJob({
      name: 'charge-card',
      queue: 'retries',
      retry: { maxAttempts: 5 },
      handler: () => {
        throw new PermanentJobError('card declined');
      },
    });
    const { container, events } = await application(job);
    const worker = createPgBossWorker({
      boss,
      container,
      queues: ['retries'],
      pollingIntervalSeconds: 0.5,
      deadLetterQueue: 'dead',
      hooks: recordingHooks(events),
      logger: silent,
    });
    await worker.start();
    const driver = new PgBossQueueDriver({ boss, deadLetterQueue: 'dead', retryDelaySeconds: 0 });

    const { jobId } = await new JobService(driver).enqueue(job, {});
    await waitForDeadLetter(boss, jobId);
    await worker.stop();

    expect(events.filter((event) => event.startsWith('start'))).toEqual(['start attempt 1']);
  });

  it('lets two workers process every job once without claiming one twice', async () => {
    const processed: string[] = [];
    const job = defineJob({
      name: 'resize-image',
      queue: 'pair',
      handler: async (payload: { n: number }, { jobId }) => {
        await sleep(5);
        processed.push(`${payload.n}:${jobId}`);
      },
    });
    const { container } = await application(job);
    const other = await startBoss();
    const workers = [boss, other].map((instance) =>
      createPgBossWorker({
        boss: instance,
        container,
        queues: ['pair'],
        concurrency: 2,
        pollingIntervalSeconds: 0.5,
        logger: silent,
      })
    );
    const jobService = new JobService(new PgBossQueueDriver({ boss }));
    for (let n = 0; n < 30; n += 1) await jobService.enqueue(job, { n });

    await Promise.all(workers.map((worker) => worker.start()));
    await waitFor(() => processed.length >= 30);
    await sleep(500);
    await Promise.all(workers.map((worker) => worker.stop()));

    expect(processed).toHaveLength(30);
    expect(new Set(processed).size).toBe(30);
  });

  it('leaves a native consumer on the same borrowed client running when stopped', async () => {
    await boss.createQueue('shared-owner');
    const job = defineJob({ name: 'shared-owner-job', queue: 'shared-owner', handler: () => {} });
    const { container } = await application(job);
    const seen: string[] = [];
    const nativeId = await boss.work(
      'shared-owner',
      { pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        seen.push(...jobs.map(({ id }) => id));
      }
    );
    const worker = createPgBossWorker({
      boss,
      container,
      queues: ['shared-owner'],
      concurrency: 2,
      logger: silent,
    });
    try {
      await worker.start();
      await worker.stop();
      const id = await boss.send('shared-owner', {});
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual([id]);
    } finally {
      await worker.stop();
      await boss.offWork('shared-owner', { id: nativeId, wait: true });
    }
  });

  it('makes the job of a crashed worker available again', async () => {
    const attempts: number[] = [];
    let crashed = false;
    const job = defineJob({
      name: 'rebuild-index',
      queue: 'crash',
      retry: { maxAttempts: 3 },
      handler: async (_payload, { attemptNumber }) => {
        attempts.push(attemptNumber);
        // The first process never finishes this attempt.
        if (!crashed) await new Promise(() => {});
      },
    });
    const { container } = await application(job);
    const doomed = await startBoss();
    const first = createPgBossWorker({
      boss: doomed,
      container,
      queues: ['crash'],
      pollingIntervalSeconds: 0.5,
      logger: silent,
    });
    await first.start();
    await new JobService(new PgBossQueueDriver({ boss, retryDelaySeconds: 0 })).enqueue(job, {});
    await waitFor(() => attempts.length === 1);

    // The process dies: its pool closes without completing or failing the job.
    crashed = true;
    await doomed.stop({ graceful: false });
    const survivor = await startBoss({ supervise: true });
    const second = createPgBossWorker({
      boss: survivor,
      container,
      queues: ['crash'],
      pollingIntervalSeconds: 0.5,
      logger: silent,
    });
    await second.start();
    await waitFor(() => attempts.length === 2, 20_000);
    await second.stop();

    expect(attempts).toEqual([1, 2]);
  }, 30_000);

  it('stops claiming on stop() and finishes the job in progress first', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished: number[] = [];
    const job = defineJob({
      name: 'archive',
      queue: 'drain',
      handler: async (payload: { n: number }) => {
        if (payload.n === 1) await gate;
        finished.push(payload.n);
      },
    });
    const { container } = await application(job);
    const worker = createPgBossWorker({
      boss,
      container,
      queues: ['drain'],
      pollingIntervalSeconds: 0.5,
      logger: silent,
    });
    const jobService = new JobService(new PgBossQueueDriver({ boss }));
    await worker.start();
    await jobService.enqueue(job, { n: 1 });
    await waitFor(async () =>
      (await boss.findJobs('drain', { queued: false })).some((found) => found.state === 'active')
    );

    let hasStopped = false;
    const stopped = worker.stop().then(() => {
      hasStopped = true;
    });
    const { messageId } = await jobService.enqueue(job, { n: 2 });
    await sleep(1000);
    expect(hasStopped).toBe(false);
    release();
    await stopped;
    await sleep(1000);

    expect(finished).toEqual([1]);
    const [later] = await boss.findJobs('drain', { id: messageId });
    expect(later?.state).toBe('created');
  });

  it('fails a message that is no job envelope or names no declared job', async () => {
    const job = defineJob({ name: 'known', queue: 'tx', handler: () => {} });
    const { container } = await application(job);
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: vi.fn() };
    await boss.createQueue('strays');
    const worker = createPgBossWorker({
      boss,
      container,
      queues: ['strays'],
      pollingIntervalSeconds: 0.5,
      logger,
    });
    const noEnvelope = await boss.send('strays', { hello: 'world' }, { retryLimit: 0 });
    const unknownJob = await boss.send('strays', { jobName: 'unknown' }, { retryLimit: 0 });
    await worker.start();

    await waitFor(async () => {
      const jobs = await boss.findJobs('strays');
      return jobs.filter((found) => found.state === 'failed').length === 2;
    });
    await worker.stop();

    const failed = (await boss.findJobs('strays')).map((found) => found.id).sort();
    expect(failed).toEqual([noEnvelope, unknownJob].sort());
    expect(logger.error).toHaveBeenCalledWith(
      'Invalid job message structure',
      expect.objectContaining({ jobId: noEnvelope })
    );
  });

  it('enqueues in the caller transaction and rolls back with it', async () => {
    const job = defineJob({ name: 'notify', queue: 'tx', handler: () => {} });
    const client = new pg.Client(databaseUrl);
    await client.connect();
    const db = {
      executeSql: async (text: string, values?: unknown[]) => client.query(text, values),
    };
    const jobService = (transactional: PgBossQueueDriver) => new JobService(transactional);
    const driver = new PgBossQueueDriver({ boss });
    try {
      await client.query('BEGIN');
      const rolledBack = await jobService(driver.inTransaction(db)).enqueue(job, {});
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      const committed = await jobService(driver.inTransaction(db)).enqueue(job, {});
      await client.query('COMMIT');

      expect(await boss.findJobs('tx', { id: rolledBack.messageId })).toEqual([]);
      expect(await boss.findJobs('tx', { id: committed.messageId })).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});

async function waitForDeadLetter(boss: PgBoss, jobId: string) {
  let found: unknown;
  await waitFor(async () => {
    const jobs = await boss.findJobs<{ jobId: string }>('dead');
    found = jobs.find((candidate) => candidate.data.jobId === jobId)?.data;
    return found !== undefined;
  });
  return found;
}
