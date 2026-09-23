import type { OnModuleDestroy } from '../core/types.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BUFFERED_BYTES = 65_536;
const CONNECTED_FRAME = 'retry: 3000\n: connected\n\n';
const HEARTBEAT_FRAME = ': heartbeat\n\n';

// A structural boundary also accepts applications with a different supported Hono version.
interface StreamContext {
  readonly req: { readonly raw: Request };
  header(name: string, value: string): void;
  newResponse(body: ReadableStream<Uint8Array>): Response;
  body(body: null, status: 503): Response;
}

export interface SseBroadcasterOptions {
  /** Heartbeat interval; 0 disables heartbeats. Defaults to 15 seconds. */
  readonly heartbeatIntervalMs?: number;
  /** Maximum queued bytes per connection. Slow clients are disconnected. Defaults to 64 KiB. */
  readonly maxBufferedBytes?: number;
}

interface Connection {
  readonly send: (frame: Uint8Array) => void;
  readonly close: () => void;
  readonly cancel: () => void;
}

/**
 * In-process, best-effort notifications for a single authorized audience.
 * Mount stream() behind application middleware. Clients must refresh state on
 * every connection: events are not persisted or replayed across reconnects.
 */
export class SseBroadcaster<Events extends object = Record<string, unknown>>
  implements OnModuleDestroy
{
  private readonly connections = new Set<Connection>();
  private readonly encoder = new TextEncoder();
  private readonly heartbeatIntervalMs: number;
  private readonly maxBufferedBytes: number;
  private isStopped = false;

  constructor(options: SseBroadcasterOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;

    if (!Number.isFinite(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 0) {
      throw new RangeError('heartbeatIntervalMs must be a finite non-negative number');
    }

    if (!Number.isSafeInteger(this.maxBufferedBytes) || this.maxBufferedBytes < 64) {
      throw new RangeError('maxBufferedBytes must be an integer of at least 64');
    }
  }

  get clientCount(): number {
    return this.connections.size;
  }

  /** Open an ordinary HTTP response; authentication/authorization belongs to the route. */
  stream(context: StreamContext): Response {
    if (this.isStopped) {
      return context.body(null, 503);
    }

    let connection: Connection | undefined;

    const body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          connection = this.createConnection(controller, context.req.raw.signal);
        },
        cancel: () => connection?.cancel(),
      },
      { highWaterMark: this.maxBufferedBytes, size: (chunk) => chunk.byteLength }
    );

    context.header('Content-Type', 'text/event-stream; charset=utf-8');
    context.header('Cache-Control', 'no-cache, no-transform');
    context.header('X-Accel-Buffering', 'no');

    return context.newResponse(body);
  }

  /** Serialize once and deliver without letting slow consumers block the publisher. */
  broadcast<Event extends keyof Events & string>(event: Event, payload: Events[Event]): void {
    if (!event || /[\r\n\0]/.test(event)) {
      throw new TypeError('SSE event names must be non-empty and contain no CR, LF or NUL');
    }

    const data = JSON.stringify(payload);
    if (data === undefined) {
      throw new TypeError('SSE payload must be JSON serializable');
    }

    const frame = this.encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
    if (frame.byteLength > this.maxBufferedBytes) {
      throw new RangeError('SSE event exceeds maxBufferedBytes');
    }

    for (const connection of this.connections) {
      connection.send(frame);
    }
  }

  /** Synchronous cleanup also works when a consumer never reads its response. */
  onModuleDestroy(): void {
    this.isStopped = true;

    for (const connection of this.connections) {
      connection.close();
    }
  }

  private createConnection(
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal
  ): Connection {
    let isClosed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const connection: Connection = {
      cancel: () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        clearInterval(heartbeat);
        signal.removeEventListener('abort', connection.close);
        this.connections.delete(connection);
      },

      close: () => {
        if (isClosed) {
          return;
        }

        connection.cancel();

        // Close synchronously without waiting for the bounded queue to drain.
        controller.close();
      },

      send: (frame) => {
        if (isClosed) {
          return;
        }

        if ((controller.desiredSize ?? 0) < frame.byteLength) {
          connection.cancel();
          controller.error(new Error('SSE client exceeded its buffer limit'));
          return;
        }

        controller.enqueue(frame);
      },
    };

    this.connections.add(connection);
    signal.addEventListener('abort', connection.close, { once: true });

    if (signal.aborted) {
      connection.close();
      return connection;
    }

    // Flush response headers and tell native EventSource how long to wait before retrying.
    connection.send(this.encoder.encode(CONNECTED_FRAME));

    if (this.heartbeatIntervalMs > 0) {
      const frame = this.encoder.encode(HEARTBEAT_FRAME);
      heartbeat = setInterval(() => connection.send(frame), this.heartbeatIntervalMs);
    }

    return connection;
  }
}
