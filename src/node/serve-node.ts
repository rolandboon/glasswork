import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createLogger, type Logger } from '../utils/logger.js';

type FetchHandler = (request: Request, ...rest: never[]) => Response | Promise<Response>;

export interface NodeHealthPaths {
  /** Answers 200 while the process runs. Default `/health/live`; `false` disables it. */
  live?: string | false;
  /** Answers 200 while the server accepts work and 503 once shutdown began. Default `/health/ready`. */
  ready?: string | false;
}

export interface ServeNodeOptions {
  /** The application's fetch handler, such as `app.fetch` from `bootstrap()`. */
  fetch: FetchHandler;
  /** Stops the application after the server closed, such as `stop` from `bootstrap()`. */
  stop: () => Promise<void>;
  /** Default `PORT` from the environment, else 3000. */
  port?: number;
  hostname?: string;
  /**
   * Work to stop as soon as shutdown begins, while in-flight requests finish: stop claiming
   * jobs, close server-sent event streams. Runs in parallel; failures are logged and make the
   * exit code 1.
   */
  drain?: Array<() => unknown>;
  /**
   * Time for in-flight requests and drain steps. Afterwards the remaining connections are
   * closed, which is logged and makes the exit code 1. Default 25000, below the 30-second
   * grace period of Kubernetes and ECS.
   */
  shutdownTimeoutMs?: number;
  /** Maximum time for application stop/disposal/telemetry after draining. Default 5000. */
  stopTimeoutMs?: number;
  health?: NodeHealthPaths;
  /** Signals that start the shutdown. A second one exits at once. Default SIGTERM and SIGINT. */
  signals?: NodeJS.Signals[] | false;
  logger?: Logger;
  /** Called with the exit code after a signal-triggered shutdown. Default `process.exit`. */
  exit?: (code: number) => void;
  onListening?: (info: AddressInfo) => void;
}

export interface NodeServer {
  /** The native Node.js server. */
  readonly server: Server;
  /** True while listening and not shutting down. */
  readonly ready: boolean;
  /** Resolves with the address once the server listens. */
  readonly listening: Promise<AddressInfo>;
  /**
   * Stops the server: readiness turns 503, new connections are refused, drain steps run,
   * in-flight requests finish within the deadline, then `stop()` runs. Resolves with the exit
   * code: 0 when everything closed in time, 1 otherwise. Calling it again returns the same
   * result. It does not exit the process; signals do.
   */
  shutdown(reason?: string): Promise<number>;
}

/** The shutdown sequence and the request guard, without a server. @internal */
export function createShutdownController(
  options: Pick<
    ServeNodeOptions,
    'fetch' | 'stop' | 'drain' | 'shutdownTimeoutMs' | 'stopTimeoutMs' | 'health' | 'logger'
  >
) {
  const logger = options.logger ?? createLogger('Glasswork:Node');
  const live = options.health?.live ?? '/health/live';
  const readyPath = options.health?.ready ?? '/health/ready';
  const timeoutMs = options.shutdownTimeoutMs ?? 25_000;
  let listening = false;
  let shuttingDown = false;
  let result: Promise<number> | undefined;

  const fetch = async (request: Request, ...rest: never[]): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (live !== false && path === live) return new Response('ok');
    if (readyPath !== false && path === readyPath) {
      return listening && !shuttingDown
        ? new Response('ready')
        : new Response('shutting down', { status: 503, headers: { connection: 'close' } });
    }
    if (shuttingDown) {
      return Response.json(
        { error: 'Service is shutting down' },
        { status: 503, headers: { connection: 'close', 'retry-after': '1' } }
      );
    }
    const response = await options.fetch(request, ...rest);
    // A request that finishes during shutdown must not keep its connection open.
    if (shuttingDown) closeAfter(response);
    return response;
  };

  async function run(server: Server, reason: string): Promise<number> {
    shuttingDown = true;
    logger.info(`Shutting down (${reason})`);
    const failures: unknown[] = [];

    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();
    const drained = Promise.allSettled((options.drain ?? []).map(async (step) => step())).then(
      (results) => {
        for (const outcome of results) {
          if (outcome.status === 'fulfilled') continue;
          logger.error('A drain step failed during shutdown', outcome.reason);
          failures.push(outcome.reason);
        }
      }
    );

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const finished = await Promise.race([
      Promise.all([closed, drained]).then(() => 'done' as const),
      deadline,
    ]);
    clearTimeout(timer);
    if (finished === 'timeout') {
      logger.error(
        `Shutdown deadline of ${timeoutMs} ms passed; closing the remaining connections`
      );
      server.closeAllConnections?.();
      failures.push(new Error('Shutdown deadline passed'));
    }

    const stopTimeoutMs = options.stopTimeoutMs ?? 5000;
    let cleanupTimer: NodeJS.Timeout | undefined;
    const cleanup = Promise.resolve()
      .then(options.stop)
      .catch((error) => {
        logger.error('Stopping the application failed', error);
        failures.push(error);
      });
    const cleanupDeadline = new Promise<'timeout'>((resolve) => {
      cleanupTimer = setTimeout(() => resolve('timeout'), stopTimeoutMs);
    });
    const cleanupResult = await Promise.race([cleanup, cleanupDeadline]);
    clearTimeout(cleanupTimer);
    if (cleanupResult === 'timeout') {
      logger.error(`Application cleanup deadline of ${stopTimeoutMs} ms passed`);
      failures.push(new Error('Application cleanup deadline passed'));
    }

    const code = failures.length === 0 ? 0 : 1;
    if (code === 0) logger.info('Shutdown complete');
    else logger.error(`Shutdown finished with ${failures.length} failure(s)`);
    return code;
  }

  return {
    fetch,
    get ready() {
      return listening && !shuttingDown;
    },
    get shuttingDown() {
      return shuttingDown;
    },
    markListening() {
      listening = true;
    },
    shutdown(server: Server, reason = 'shutdown requested'): Promise<number> {
      result ??= run(server, reason);
      return result;
    },
  };
}

function closeAfter(response: Response): void {
  try {
    response.headers.set('connection', 'close');
  } catch {
    // Immutable headers, such as on a redirect; Node closes the idle socket after close().
  }
}

/**
 * Serves an application on Node.js with `@hono/node-server`, and stops it in order on
 * SIGTERM or SIGINT: readiness turns 503, the server stops accepting connections, drain steps
 * run, in-flight requests finish within the deadline, `stop()` closes providers and flushes
 * telemetry, and the process exits with 0, or 1 when something failed or the deadline passed.
 *
 * Requires the optional peer `@hono/node-server`.
 */
export function serveNode(options: ServeNodeOptions): NodeServer {
  const logger = options.logger ?? createLogger('Glasswork:Node');
  const controller = createShutdownController({ ...options, logger });
  let resolveListening: (info: AddressInfo) => void = () => {};
  const listening = new Promise<AddressInfo>((resolve) => {
    resolveListening = resolve;
  });

  const server = serve(
    {
      fetch: controller.fetch as never,
      port: options.port ?? Number(process.env.PORT ?? 3000),
      hostname: options.hostname,
    },
    (info) => {
      controller.markListening();
      options.onListening?.(info);
      resolveListening(info);
    }
  ) as Server;

  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals === false ? [] : (options.signals ?? ['SIGTERM', 'SIGINT']);
  let stopped: Promise<number> | undefined;
  const shutdown = (reason?: string) => {
    stopped ??= controller.shutdown(server, reason).finally(() => {
      for (const name of signals) process.removeListener(name, onSignal);
    });
    return stopped;
  };
  const onSignal = (signal: NodeJS.Signals) => {
    if (controller.shuttingDown) {
      logger.error(`Received ${signal} during shutdown; exiting now`);
      exit(1);
      return;
    }
    void shutdown(signal).then(exit);
  };
  for (const signal of signals) process.on(signal, onSignal);

  return {
    server,
    get ready() {
      return controller.ready;
    },
    listening,
    shutdown,
  };
}
