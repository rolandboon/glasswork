import { defineModule } from 'glasswork/core';
import { DatabaseModule } from '../platform/database.module.js';
import { OrderEventsConsumer } from './order-events.consumer.js';

export {
  OrderEventsConsumer,
  type SqsRecord,
  UnsupportedPayloadVersionError,
} from './order-events.consumer.js';

/** Consumes order events from a queue; it shares no code path with the orders module. */
export const LoyaltyModule = defineModule({
  name: 'loyalty',
  imports: [DatabaseModule],
  providers: [OrderEventsConsumer],
  exports: ['orderEventsConsumer'],
});
