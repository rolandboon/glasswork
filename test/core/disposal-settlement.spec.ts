import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';

describe('provider disposal completion', () => {
  it('waits for all disposers and reports every failure', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = new Error('First close failed');
    const second = new Error('Second close failed');
    const closed = vi.fn();
    const { container, stop } = await bootstrap(
      defineModule({
        name: 'resources',
        providers: [
          {
            provide: 'first',
            useFactory: () => ({}),
            dispose: () => {
              throw first;
            },
          },
          {
            provide: 'second',
            useFactory: () => ({}),
            dispose: async () => {
              await pending;
              closed();
              throw second;
            },
          },
        ],
      }),
      { environment: 'test', logger: { enabled: false } }
    );
    container.resolve('first');
    container.resolve('second');
    let settled = false;
    const stopping = stop()
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    const error = await stopping;
    expect(closed).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([first, second]);
    await expect(stop()).rejects.toBe(error);
    expect(closed).toHaveBeenCalledOnce();
  });

  it.each(['class', 'factory'])('rejects an untrackable transient %s disposer', async (kind) => {
    class Resource {}
    const provider = kind === 'class' ? { useClass: Resource } : { useFactory: () => ({}) };
    await expect(
      bootstrap(
        defineModule({
          name: 'resources',
          providers: [{ provide: 'client', ...provider, scope: 'TRANSIENT', dispose: vi.fn() }],
        }),
        { environment: 'test' }
      ).then(() => 'resolved')
    ).rejects.toThrow('dispose requires SINGLETON or SCOPED');
  });
});
