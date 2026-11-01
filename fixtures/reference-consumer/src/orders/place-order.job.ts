import { defineJob } from 'glasswork/jobs';
import * as v from 'valibot';
import type { OrderTransactions } from './order-transactions.js';

const PlaceOrderPayload = v.object({
  tenantId: v.string(),
  actorUserId: v.string(),
  sku: v.string(),
  quantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

interface PlaceOrderServices {
  orderTransactions: OrderTransactions;
}

/** Places an order from a job: the same use case and adapter as the HTTP route. */
export const placeOrderJob = defineJob<typeof PlaceOrderPayload, PlaceOrderServices>({
  name: 'place-order',
  schema: PlaceOrderPayload,
  handler: async (payload, { services }) => {
    await services.orderTransactions.placeOrder(payload);
  },
});
