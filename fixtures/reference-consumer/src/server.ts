import { serve } from '@hono/node-server';
import { bootstrap } from 'glasswork/core';
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

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  console.log(`listening on ${info.port}`);
});

process.once('SIGTERM', () => {
  server.close(async () => {
    await relay?.stop();
    await stop();
    process.exit(0);
  });
});
