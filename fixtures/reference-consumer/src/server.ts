import { bootstrap } from 'glasswork/core';
import { serveNode } from 'glasswork/node';
import { AppModule } from './app.module.js';
import { type OutboxRelay, RelayLoop } from './platform/messaging.module.js';

const { app, container, stop } = await bootstrap(AppModule);

// This process owns the relay loop when it can publish; a Lambda deployment schedules
// `relayOutbox` instead.
const relay = process.env.EVENTS_QUEUE_URL
  ? new RelayLoop(container.resolve('outboxRelay') as OutboxRelay, {
      onError: (error) => console.error('Outbox relay failed', error),
    }).start()
  : undefined;

// SIGTERM or SIGINT: readiness turns 503, new connections are refused, the relay stops
// claiming, in-flight requests finish within the deadline, then stop() closes the
// providers and the process exits with 0, or 1 when something failed.
serveNode({
  fetch: app.fetch,
  stop,
  drain: [() => relay?.stop()],
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000),
  onListening: (info) => console.log(`listening on ${info.port}`),
});
