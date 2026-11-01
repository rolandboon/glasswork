import type { AwilixContainer } from 'awilix';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapRuntime } from '../../src/core/bootstrap-runtime.js';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { createPgBossWorker, type PgBossConsumer } from '../../src/jobs/pg-boss-worker.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(queues = ['queue']) {
  const boss = {
    work: vi.fn(async () => 'owned-id'),
    offWork: vi.fn(async () => {}),
    send: vi.fn(async () => 'sent'),
  };
  const worker = createPgBossWorker({
    boss: boss as PgBossConsumer,
    container: {} as AwilixContainer,
    queues,
  });
  return { boss, worker };
}

describe('pg-boss worker ownership and lifecycle', () => {
  it('shares completion between concurrent starts', async () => {
    const { boss, worker } = setup();
    const gate = deferred<string>();
    boss.work.mockReturnValue(gate.promise);
    const first = worker.start();
    let ready = false;
    const second = worker.start().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    gate.resolve('owned-id');
    await Promise.all([first, second]);
    expect(boss.work).toHaveBeenCalledOnce();
    await worker.stop();
  });

  it('stops only the work registration it owns on a borrowed client', async () => {
    const { boss, worker } = setup();
    await worker.start();
    await worker.stop();
    expect(boss.offWork).toHaveBeenCalledWith('queue', { id: 'owned-id', wait: true });
  });

  it('cleans partial registration failure and keeps the original start failure', async () => {
    const { boss, worker } = setup(['one', 'two']);
    const failure = new Error('second queue unavailable');
    boss.work.mockResolvedValueOnce('first-id').mockRejectedValueOnce(failure);
    await expect(worker.start()).rejects.toBe(failure);
    await expect(worker.start()).rejects.toBe(failure);
    expect(boss.offWork).toHaveBeenCalledWith('one', { id: 'first-id', wait: true });
    await worker.stop();
    expect(boss.offWork).toHaveBeenCalledTimes(1);
  });

  it('stops a registration that completes after stop was requested', async () => {
    const { boss, worker } = setup(['one', 'two']);
    const gate = deferred<string>();
    boss.work.mockReturnValue(gate.promise);
    const start = worker.start();
    const stop = worker.stop();
    gate.resolve('first-id');
    await Promise.all([start, stop]);
    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(boss.offWork).toHaveBeenCalledWith('one', { id: 'first-id', wait: true });
    await expect(worker.start()).rejects.toThrow(/stopped/);
  });

  it('never starts after being stopped before start', async () => {
    const { boss, worker } = setup();
    await worker.stop();
    await expect(worker.start()).rejects.toThrow(/stopped/);
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.offWork).not.toHaveBeenCalled();
  });
});

it('waits for all owned registrations when stopping one fails', async () => {
  const { boss, worker } = setup(['one', 'two']);
  const gate = deferred<void>();
  const failure = new Error('first stop failed');
  boss.work.mockResolvedValueOnce('one-id').mockResolvedValueOnce('two-id');
  boss.offWork.mockRejectedValueOnce(failure).mockReturnValueOnce(gate.promise);
  await worker.start();
  let finished = false;
  const stopped = worker.stop().catch((error) => {
    finished = true;
    return error;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finished).toBe(false);
  gate.resolve();
  expect(await stopped).toBe(failure);
  expect(boss.offWork).toHaveBeenCalledTimes(2);
});

it('rejects ambiguous job owners before a pg-boss worker can execute the wrong module', async () => {
  const job = () => defineJob({ name: 'shared-name', handler: () => {} });
  const module = defineModule({
    name: 'app',
    imports: [
      defineModule({ name: 'billing', jobs: [job()] }),
      defineModule({ name: 'reporting', jobs: [job()] }),
    ],
  });
  await expect(bootstrapRuntime(module, { environment: 'test' })).rejects.toThrow(
    /already registered/
  );
});
