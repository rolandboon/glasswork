import * as v from 'valibot';

export const ORDER_PLACED = 'order.placed';

/**
 * Version 1 of the order.placed payload. An incompatible change gets a new version;
 * keep publishing or accepting the old one while consumers may still receive it.
 */
export const OrderPlacedV1 = v.object({
  orderId: v.string(),
  sku: v.string(),
  quantity: v.number(),
  actorUserId: v.string(),
});
export type OrderPlacedV1 = v.InferOutput<typeof OrderPlacedV1>;
