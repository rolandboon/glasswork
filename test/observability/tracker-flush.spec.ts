import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import {
  type CloudWatchClientLike,
  createCloudWatchTracker,
  type ExceptionTracker,
  flushExceptionTracker,
} from '../../src/observability/exception-tracking.js';
import { createSanitizedExceptionTracker } from '../../src/observability/sanitizers.js';
import { createLogger } from '../../src/utils/logger.js';

function deferredClient() {
  const releases: Array<(error?: Error) => void> = [];
  const client: CloudWatchClientLike & { destroy: ReturnType<typeof vi.fn> } = {
    send: vi.fn(
      () =>
        new Promise<unknown>((resolve, reject) => {
          releases.push((error) => (error ? reject(error) : resolve({})));
        })
    ),
    destroy: vi.fn(),
  };
  const releaseAll = (error?: Error) => {
    for (const release of releases) release(error);
  };
  return { client, releaseAll };
}

function createTracker(client: CloudWatchClientLike) {
  return createCloudWatchTracker({
    cloudWatchClient: client,
    logger: createLogger('tracker', 'silent'),
  });
}

/** putMetric awaits a dynamic import before sending. */
const sendsStarted = (client: CloudWatchClientLike, count: number) =>
  vi.waitFor(() => expect(client.send).toHaveBeenCalledTimes(count));

describe('CloudWatch tracker flush', () => {
  it('waits for metrics that are still being sent', async () => {
    const { client, releaseAll } = deferredClient();
    const tracker = createTracker(client);
    tracker.captureException(new Error('boom'));
    await sendsStarted(client, 1);

    const flushing = tracker.flush?.(1000);
    releaseAll();

    await expect(flushing).resolves.toEqual({ completed: true, pending: 0 });
  });

  it('reports pending metrics when the deadline passes first', async () => {
    const { client, releaseAll } = deferredClient();
    const tracker = createTracker(client);
    tracker.captureException(new Error('first'));
    tracker.captureMessage('second', 'error');
    await sendsStarted(client, 2);

    await expect(tracker.flush?.(5)).resolves.toEqual({ completed: false, pending: 2 });
    releaseAll();
  });

  it('completes when a metric fails to send', async () => {
    const { client, releaseAll } = deferredClient();
    const tracker = createTracker(client);
    tracker.captureException(new Error('boom'));
    await sendsStarted(client, 1);

    const flushing = tracker.flush?.(1000);
    releaseAll(new Error('CloudWatch unavailable'));

    await expect(flushing).resolves.toEqual({ completed: true, pending: 0 });
  });

  it('stops sending on close and leaves a client it did not create', async () => {
    const { client, releaseAll } = deferredClient();
    const tracker = createTracker(client);
    tracker.captureException(new Error('boom'));
    await sendsStarted(client, 1);

    const closing = tracker.close?.(1000);
    releaseAll();
    await closing;
    tracker.captureException(new Error('after close'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();
  });
});

describe('flushExceptionTracker', () => {
  const base: ExceptionTracker = {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    setUser: vi.fn(),
    setContext: vi.fn(),
  };

  it.each([
    ['without flush', base, { completed: true, pending: 0 }],
    ['returning true', { ...base, flush: async () => true }, { completed: true, pending: 0 }],
    ['returning false', { ...base, flush: async () => false }, { completed: false, pending: 0 }],
    [
      'returning a result',
      { ...base, flush: async () => ({ completed: false, pending: 3 }) },
      { completed: false, pending: 3 },
    ],
  ])('normalizes a tracker %s', async (_case, tracker, expected) => {
    await expect(flushExceptionTracker(tracker as ExceptionTracker, 100)).resolves.toEqual(
      expected
    );
  });

  it('never throws when flush fails', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const tracker: ExceptionTracker = {
      ...base,
      flush: async () => {
        throw new Error('flush failed');
      },
    };

    await expect(flushExceptionTracker(tracker, 100, logger)).resolves.toEqual({
      completed: false,
      pending: 0,
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('bounds a tracker that ignores its timeout', async () => {
    vi.useFakeTimers();
    try {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      let result: unknown;
      void flushExceptionTracker({ ...base, flush: () => new Promise(() => {}) }, 10, logger).then(
        (value) => {
          result = value;
        }
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(result).toEqual({ completed: false, pending: 0 });
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is forwarded by the sanitized tracker', async () => {
    const flush = vi.fn(async () => true);

    await flushExceptionTracker(createSanitizedExceptionTracker({ ...base, flush }), 250);

    expect(flush).toHaveBeenCalledWith(250);
  });
});

describe('bootstrap stop', () => {
  const base: ExceptionTracker = {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    setUser: vi.fn(),
    setContext: vi.fn(),
  };

  it('flushes the exception tracker with the configured deadline', async () => {
    const flush = vi.fn(async () => true);
    const { start, stop } = await bootstrap(defineModule({ name: 'app' }), {
      environment: 'test',
      exceptionTracking: { tracker: { ...base, flush }, flushTimeoutMs: 300 },
    });
    await start();

    await stop();

    expect(flush).toHaveBeenCalledExactlyOnceWith(300);
  });

  it('flushes after a failing destroy hook and still reports that failure', async () => {
    const flush = vi.fn(async () => {
      throw new Error('flush failed');
    });
    class FailingService {
      onModuleDestroy() {
        throw new Error('Close failed');
      }
    }
    const { start, stop } = await bootstrap(
      defineModule({ name: 'app', providers: [FailingService] }),
      { environment: 'test', exceptionTracking: { tracker: { ...base, flush } } }
    );
    await start();

    await expect(stop()).rejects.toThrow('Close failed');
    expect(flush).toHaveBeenCalledExactlyOnceWith(2000);
  });
});
