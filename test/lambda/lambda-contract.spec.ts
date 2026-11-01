import type { Context as LambdaContext } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';
import { createRoutes } from '../../src/http/route-helpers.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { createLambdaHandler } from '../../src/lambda/index.js';
import type { ExceptionTracker } from '../../src/observability/exception-tracking.js';
import { createLogger } from '../../src/utils/logger.js';

const silent = createLogger('test', 'silent');

function captureLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A Lambda context whose deadline is `remainingMs` from now. */
function lambdaContext(remainingMs = 30_000): LambdaContext {
  const deadline = Date.now() + remainingMs;
  return {
    awsRequestId: 'request-1',
    getRemainingTimeInMillis: () => deadline - Date.now(),
  } as unknown as LambdaContext;
}

function apiEvent(path: string) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { host: 'example.com' },
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '192.0.2.1', userAgent: 'test' },
      requestId: 'request',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
  };
}

/** A tracker whose flush finishes after `flushMs`, or never. */
function tracker(flushMs: number | 'never') {
  const captured: Error[] = [];
  const value: ExceptionTracker = {
    captureException: (error) => {
      captured.push(error);
    },
    captureMessage: () => {},
    setUser: () => {},
    setContext: () => {},
    flush: () =>
      flushMs === 'never'
        ? new Promise(() => {})
        : new Promise((resolve) =>
            setTimeout(() => resolve({ completed: true, pending: 0 }), flushMs)
          ),
  };
  return { value, captured };
}

function lifecycleModule(options: { failInit?: boolean } = {}) {
  const counts = { init: 0, singletons: 0, scoped: 0, scopedDisposed: 0, singletonDisposed: 0 };
  const routes = createRoutes((router, services) => {
    router.get('/ping', (c) => {
      const { requestState, sharedClient } = services as {
        requestState: { id: number };
        sharedClient: { id: number };
      };
      return c.json({ request: requestState.id, client: sharedClient.id });
    });
    router.get('/fail', () => {
      throw new Error('unexpected');
    });
  });
  const AppModule: ModuleConfig = defineModule({
    name: 'app',
    basePath: 'app',
    providers: [
      {
        provide: 'sharedClient',
        useFactory: () => ({
          id: ++counts.singletons,
          onModuleInit: () => {
            counts.init += 1;
            if (options.failInit) throw new Error('database unreachable');
          },
        }),
        dispose: () => {
          counts.singletonDisposed += 1;
        },
      },
      {
        provide: 'requestState',
        scope: 'SCOPED',
        useFactory: () => ({ id: ++counts.scoped }),
        dispose: () => {
          counts.scopedDisposed += 1;
        },
      },
    ],
    routes,
  });
  return { AppModule, counts };
}

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

describe('createLambdaHandler', () => {
  it('initializes once, reuses singletons when warm and isolates each request scope', async () => {
    const { AppModule, counts } = lifecycleModule();
    let initializations = 0;
    const handler = createLambdaHandler(() => {
      initializations += 1;
      return bootstrap(AppModule, { environment: 'production', logger: { instance: silent } });
    });

    const responses = [];
    for (let invocation = 0; invocation < 3; invocation += 1) {
      responses.push(await handler(apiEvent('/api/app/ping') as never, lambdaContext()));
    }

    expect(responses.map((response) => JSON.parse(response.body))).toEqual([
      { request: 1, client: 1 },
      { request: 2, client: 1 },
      { request: 3, client: 1 },
    ]);
    expect(initializations).toBe(1);
    expect(counts).toEqual({
      init: 1,
      singletons: 1,
      scoped: 3,
      scopedDisposed: 3,
      singletonDisposed: 0,
    });
  });

  it('fails every invocation with the initialization error, logged once', async () => {
    const { AppModule } = lifecycleModule({ failInit: true });
    const logger = captureLogger();
    const handler = createLambdaHandler(
      bootstrap(AppModule, { environment: 'production', logger: { instance: silent } }),
      { logger }
    );

    await expect(handler(apiEvent('/api/app/ping') as never)).rejects.toThrow(
      'database unreachable'
    );
    await expect(handler(apiEvent('/api/app/ping') as never)).rejects.toThrow(
      'database unreachable'
    );
    expect(logger.error).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
  });

  it('waits for exception reports before returning', async () => {
    const { AppModule } = lifecycleModule();
    const reports = tracker(50);
    const handler = createLambdaHandler(
      bootstrap(AppModule, {
        environment: 'test',
        logger: { instance: silent },
        exceptionTracking: { tracker: reports.value },
      })
    );

    const startedAt = Date.now();
    const response = await handler(apiEvent('/api/app/fail') as never, lambdaContext());

    expect(response.statusCode).toBe(500);
    expect(reports.captured.map((error) => error.message)).toEqual(['unexpected']);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45);
  });

  it('returns the response once the flush budget runs out, and logs the timeout', async () => {
    const { AppModule } = lifecycleModule();
    const logger = captureLogger();
    const handler = createLambdaHandler(
      bootstrap(AppModule, {
        environment: 'test',
        logger: { instance: silent },
        exceptionTracking: { tracker: tracker('never').value },
      }),
      { logger, flushTimeoutMs: 2000, safetyMarginMs: 500 }
    );

    const startedAt = Date.now();
    // 700 ms left: the flush may take 200 ms, keeping 500 ms free.
    const response = await handler(apiEvent('/api/app/ping') as never, lambdaContext(700));

    expect(response.statusCode).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(600);
    expect(logger.warn).toHaveBeenCalledWith(
      'Exception reports were still being sent when the invocation returned',
      { pending: 0 }
    );
  });
});

describe('bootstrapWorker in Lambda', () => {
  function jobModule(options: { failInit?: boolean } = {}) {
    const job = defineJob({
      name: 'charge',
      retry: { maxAttempts: 5 },
      handler: () => {
        throw new Error('gateway timeout');
      },
    });
    return defineModule({
      name: 'billing',
      providers: [
        {
          provide: 'gateway',
          useFactory: () => ({
            onModuleInit: () => {
              if (options.failInit) throw new Error('secrets unavailable');
            },
          }),
        },
      ],
      jobs: [job],
    });
  }

  const record = {
    Records: [
      {
        messageId: 'message-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify({ jobName: 'charge', payload: {}, jobId: 'job-1' }),
        attributes: { ApproximateReceiveCount: '1' },
      },
    ],
  };

  it('reports a failed attempt and waits for the report, bounded by the remaining time', async () => {
    const reports = tracker('never');
    const logger = captureLogger();
    const worker = bootstrapWorker({
      module: jobModule(),
      environment: 'test',
      logger,
      metrics: { enabled: false },
      exceptionTracking: { tracker: reports.value },
    });

    const startedAt = Date.now();
    const result = await worker(record as never, lambdaContext(700));

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'message-1' }] });
    expect(reports.captured.map((error) => error.message)).toEqual(['gateway timeout']);
    expect(Date.now() - startedAt).toBeLessThan(600);
    expect(logger.warn).toHaveBeenCalledWith(
      'Exception reports were still being sent when the invocation returned',
      { pending: 0 }
    );
  });

  it('keeps the batch result when the tracker itself fails', async () => {
    const logger = captureLogger();
    const worker = bootstrapWorker({
      module: jobModule(),
      environment: 'test',
      logger,
      metrics: { enabled: false },
      exceptionTracking: {
        tracker: {
          ...tracker(0).value,
          captureException: () => {
            throw new Error('tracker offline');
          },
        },
      },
    });

    const result = await worker(record as never, lambdaContext());

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'message-1' }] });
  });

  it('fails every invocation with the initialization error and leaves no unhandled rejection', async () => {
    const logger = captureLogger();
    const worker = bootstrapWorker({
      module: jobModule({ failInit: true }),
      environment: 'production',
      logger,
    });

    await expect(worker(record as never)).rejects.toThrow('secrets unavailable');
    await expect(worker(record as never)).rejects.toThrow('secrets unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      'Worker failed to initialize; every invocation fails with this error',
      expect.objectContaining({ message: 'secrets unavailable' })
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
  });
});

it('preserves the HTTP result when logging a flush timeout fails', async () => {
  const { AppModule } = lifecycleModule();
  const logger = {
    ...silent,
    warn: () => {
      throw new Error('logging offline');
    },
    error: () => {
      throw new Error('logging offline');
    },
  };
  const handler = createLambdaHandler(
    bootstrap(AppModule, {
      environment: 'test',
      logger: { instance: logger },
      exceptionTracking: { tracker: tracker('never').value },
    }),
    { logger, flushTimeoutMs: 10 }
  );
  expect((await handler(apiEvent('/api/app/ping') as never, lambdaContext())).statusCode).toBe(200);
});

it('keeps a worker discard result when tracker and diagnostics both fail', async () => {
  const module = defineModule({
    name: 'discard',
    jobs: [
      defineJob({
        name: 'discard',
        retry: false,
        handler: () => {
          throw new Error('expected discard');
        },
      }),
    ],
  });
  let warnings = 0;
  const logger = {
    ...silent,
    warn: () => {
      if (++warnings > 1) throw new Error('logging offline');
    },
  };
  const worker = bootstrapWorker({
    module,
    environment: 'test',
    logger,
    metrics: { enabled: false },
    exceptionTracking: {
      tracker: {
        ...tracker(0).value,
        captureException: () => {
          throw new Error('tracker offline');
        },
      },
    },
  });
  expect(await worker({ jobName: 'discard' })).toEqual({ success: true });
  expect(warnings).toBe(2);
});

it('retains initialization failure without an unhandled rejection when its logger fails', async () => {
  const failure = new Error('initialization unavailable');
  const handler = createLambdaHandler(Promise.reject(failure), {
    logger: {
      ...silent,
      error: () => {
        throw new Error('log unavailable');
      },
    },
  });
  await expect(handler(apiEvent('/anything') as never)).rejects.toBe(failure);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(unhandled).toEqual([]);
});
