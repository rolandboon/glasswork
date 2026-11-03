import { describe, expect, it, vi } from 'vitest';
import { bootstrapRuntime } from '../../src/core/bootstrap-runtime.js';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/utils/logger.js';

const silent = { instance: createLogger('test', 'silent') };

function modules() {
  const disposed: string[] = [];
  let scoped = 0;
  const StorageModule = defineModule({
    name: 'storage',
    providers: [
      { provide: 'storageSecret', useValue: 'private' },
      {
        provide: 'storage',
        async: true,
        useFactory: async () => ({ kind: 'storage' }),
      },
    ],
    exports: ['storage'],
  });
  const ReportsModule = defineModule({
    name: 'reports',
    imports: [StorageModule],
    providers: [
      {
        provide: 'reportRun',
        scope: 'SCOPED',
        useFactory: () => ({ id: ++scoped }),
        dispose: (run: { id: number }) => {
          disposed.push(`run ${run.id}`);
        },
      },
      {
        provide: 'reportService',
        useFactory: ({ storage }: { storage: { kind: string } }) => ({ storage }),
      },
    ],
  });
  return { ReportsModule, disposed };
}

describe('bootstrapRuntime', () => {
  it('keeps module boundaries, overrides and async factories as bootstrap does', async () => {
    const { ReportsModule } = modules();

    const runtime = await bootstrapRuntime(ReportsModule, {
      environment: 'test',
      logger: silent,
      providerOverrides: [{ provide: 'storage', useValue: { kind: 'override' } }],
    });

    expect(runtime.container.resolve('reportService')).toEqual({ storage: { kind: 'override' } });
    expect(() => runtime.container.resolve('storageSecret')).toThrow(/not available/);
    await runtime.stop();
  });

  it('gives every use case its own scope and disposes it, also when the use case fails', async () => {
    const { ReportsModule, disposed } = modules();
    const runtime = await bootstrapRuntime(ReportsModule, { environment: 'test', logger: silent });

    const first = await runtime.withScope((services) => services.reportRun);
    await expect(
      runtime.withScope((services) => {
        void services.reportRun;
        throw new Error('report failed');
      })
    ).rejects.toThrow('report failed');

    expect(first).toEqual({ id: 1 });
    expect(disposed).toEqual(['run 1', 'run 2']);
    await runtime.stop();
  });

  it('starts outside tests, and on a failed start closes what it created and leaves borrowed values open', async () => {
    const closeOwned = vi.fn();
    const closeBorrowed = vi.fn();
    const borrowed = { close: closeBorrowed };
    const TaskModule = defineModule({
      name: 'task',
      providers: [
        { provide: 'client', useValue: { placeholder: true } },
        {
          provide: 'connection',
          useFactory: () => ({ open: true }),
          dispose: closeOwned,
        },
        {
          provide: 'migrator',
          useFactory: ({ connection }: { connection: object }) => ({
            connection,
            onModuleInit: () => {
              throw new Error('migration lock unavailable');
            },
          }),
        },
      ],
    });

    await expect(
      bootstrapRuntime(TaskModule, {
        environment: 'development',
        logger: silent,
        providerOverrides: [{ provide: 'client', useValue: borrowed }],
      })
    ).rejects.toThrow('migration lock unavailable');

    expect(closeOwned).toHaveBeenCalledOnce();
    expect(closeBorrowed).not.toHaveBeenCalled();
  });
});

describe('bootstrapWorker on the shared runtime', () => {
  it('runs onModuleInit once before the first job outside tests, and applies overrides', async () => {
    const events: string[] = [];
    const job = defineJob({
      name: 'sync',
      handler: (_payload, { services }) => {
        events.push(`job uses ${(services.gateway as { name: string }).name}`);
      },
    });
    const SyncModule = defineModule({
      name: 'sync',
      providers: [
        { provide: 'gateway', useValue: { name: 'real' } },
        {
          provide: 'warmup',
          useFactory: () => ({
            onModuleInit: () => {
              events.push('init');
            },
          }),
        },
      ],
      jobs: [job],
    });

    const worker = bootstrapWorker({
      module: SyncModule,
      environment: 'production',
      logger: createLogger('worker', 'silent'),
      metrics: { enabled: false },
      providerOverrides: [{ provide: 'gateway', useValue: { name: 'fake' } }],
    });
    await worker({ jobName: 'sync' });
    await worker({ jobName: 'sync' });

    expect(events).toEqual(['init', 'job uses fake', 'job uses fake']);
  });
});

it('releases initialized resources when worker setup fails after runtime creation', async () => {
  const dispose = vi.fn();
  const job = defineJob({ name: 'setup-failure', handler: () => {} });
  const module = defineModule({
    name: 'invalid-worker',
    jobs: [job],
    providers: [
      { provide: 'owned', async: true, useFactory: async () => ({}), dispose },
      {
        provide: 'logger',
        useFactory: () => {
          throw new Error('logger setup failed');
        },
      },
    ],
  });
  const worker = bootstrapWorker({ module, environment: 'test', logger: silent.instance });
  await expect(worker({ jobName: 'setup-failure' })).rejects.toThrow('logger setup failed');
  expect(dispose).toHaveBeenCalledOnce();
});
