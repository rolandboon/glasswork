import { bootstrap } from 'glasswork/core';
import { bootstrapWorker } from 'glasswork/jobs';
import { createLambdaHandler } from 'glasswork/lambda';
import { AppModule } from './app.module.js';
import type { OrderEventsConsumer, SqsRecord } from './loyalty/loyalty.module.js';
import type { OutboxRelay } from './platform/messaging.module.js';

// Initialized once per execution environment; a failed start fails every invocation.
const application = bootstrap(AppModule);

/** API Gateway or Function URL handler. */
export const handler = createLambdaHandler(application);

/** SQS handler for the jobs this application declares. */
export const worker = bootstrapWorker({ module: AppModule });

/** Run on a schedule, for example every minute: publishes one bounded batch of outbox events. */
export const relayOutbox = async () => {
  const { container } = await application;
  return (container.resolve('outboxRelay') as OutboxRelay).relayBatch(
    Number(process.env.RELAY_BATCH ?? 100)
  );
};

/** SQS handler for order events, with partial batch responses enabled on the event source. */
export const orderEvents = async (event: { Records: SqsRecord[] }) => {
  const { container } = await application;
  return (container.resolve('orderEventsConsumer') as OrderEventsConsumer).handle(event);
};
