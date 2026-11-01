import { bootstrap } from 'glasswork/core';
import { bootstrapWorker } from 'glasswork/jobs';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module.js';
import type { OrderEventsConsumer, SqsRecord } from './loyalty/loyalty.module.js';
import type { OutboxRelay } from './platform/messaging.module.js';

const { app, container } = await bootstrap(AppModule);

/** API Gateway or Function URL handler. */
export const handler = handle(app);

/** SQS handler for the jobs this application declares. */
export const worker = bootstrapWorker({ module: AppModule });

/** Run on a schedule, for example every minute: publishes one bounded batch of outbox events. */
export const relayOutbox = () =>
  (container.resolve('outboxRelay') as OutboxRelay).relayBatch(
    Number(process.env.RELAY_BATCH ?? 100)
  );

/** SQS handler for order events, with partial batch responses enabled on the event source. */
export const orderEvents = (event: { Records: SqsRecord[] }) =>
  (container.resolve('orderEventsConsumer') as OrderEventsConsumer).handle(event);
