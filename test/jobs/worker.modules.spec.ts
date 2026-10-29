import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/index.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';

describe('worker module boundaries', () => {
  it('uses each job owner module and isolates scoped instances per invocation', async () => {
    const seen: Array<{ owner: string; state: object }> = [];
    const feature = (name: string) =>
      defineModule({
        name,
        providers: [
          { provide: 'owner', useValue: name },
          { provide: 'state', scope: 'SCOPED', useFactory: () => ({}) },
        ],
        jobs: [
          defineJob({
            name,
            handler: (_payload, { services }) => {
              seen.push({ owner: services.owner as string, state: services.state as object });
            },
          }),
        ],
      });
    const handler = bootstrapWorker({
      module: defineModule({ name: 'root', imports: [feature('a'), feature('b')] }),
    });
    await handler({ jobName: 'a' });
    await handler({ jobName: 'b' });
    await handler({ jobName: 'a' });
    expect(seen.map((entry) => entry.owner)).toEqual(['a', 'b', 'a']);
    expect(new Set(seen.map((entry) => entry.state)).size).toBe(3);
  });

  it('does not expose sibling private providers to jobs', async () => {
    const onJobFailed = vi.fn();
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'secret', useValue: 42 }],
    });
    const consumer = defineModule({
      name: 'consumer',
      imports: [source],
      jobs: [
        defineJob({
          name: 'read',
          handler: (_payload, { services }) => {
            void services.secret;
          },
        }),
      ],
    });
    const handler = bootstrapWorker({
      module: defineModule({ name: 'root', imports: [source, consumer] }),
      hooks: { onJobFailed },
    });
    await expect(handler({ jobName: 'read' })).rejects.toThrow(
      'not available in module "consumer"'
    );
    expect(onJobFailed).toHaveBeenCalledOnce();
  });

  it('permits imported exports in job handlers', async () => {
    const seen = vi.fn();
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'shared', useValue: 42 }],
      exports: ['shared'],
    });
    const consumer = defineModule({
      name: 'consumer',
      imports: [source],
      jobs: [
        defineJob({
          name: 'read',
          handler: (_payload, { services }) => {
            seen(services.shared);
          },
        }),
      ],
    });
    const handler = bootstrapWorker({
      module: defineModule({ name: 'root', imports: [consumer] }),
    });
    await handler({ jobName: 'read' });
    expect(seen).toHaveBeenCalledWith(42);
  });

  it('falls back to the root module logger for jobs in feature modules', async () => {
    const info = vi.fn();
    const logger = { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() };
    const feature = defineModule({
      name: 'feature',
      jobs: [
        defineJob({
          name: 'log',
          handler: (_payload, { logger }) => {
            logger?.info('from job');
          },
        }),
      ],
    });
    const handler = bootstrapWorker({
      module: defineModule({
        name: 'root',
        imports: [feature],
        providers: [{ provide: 'logger', useValue: logger }],
      }),
    });
    await handler({ jobName: 'log' });
    expect(info).toHaveBeenCalledWith('from job');
  });
});
