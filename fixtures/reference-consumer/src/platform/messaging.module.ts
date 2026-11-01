import { defineModule } from 'glasswork/core';
import { type Database, DatabaseModule } from './database.module.js';
import { type EventPublisher, OutboxRelay } from './outbox.js';
import { SqsEventPublisher } from './sqs-event-publisher.js';

export { parseEnvelope, receiveOnce } from './inbox.js';
export {
  type EventEnvelope,
  type EventPublisher,
  type NewEvent,
  type Outbox,
  OutboxRelay,
  type OutboxRelayOptions,
  outboxIn,
  RelayLoop,
  type RelayResult,
} from './outbox.js';
export { SqsEventPublisher } from './sqs-event-publisher.js';

/** The outbox relay and the publisher it uses. Writing and receiving events need no DI. */
export const MessagingModule = defineModule({
  name: 'messaging',
  imports: [DatabaseModule],
  providers: [
    {
      provide: 'eventPublisher',
      useFactory: () => new SqsEventPublisher({ queueUrl: process.env.EVENTS_QUEUE_URL }),
    },
    {
      provide: 'outboxRelay',
      useFactory: ({
        prisma,
        eventPublisher,
      }: {
        prisma: Database;
        eventPublisher: EventPublisher;
      }) => new OutboxRelay({ prisma, eventPublisher }),
    },
  ],
  exports: ['outboxRelay'],
});
