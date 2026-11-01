import type { AuthContext } from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import { BadRequestException, createRoutes } from 'glasswork/http';
import * as v from 'valibot';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AuditModule } from '../platform/audit.module.js';
import { type AppUser, type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { DatabaseModule } from '../platform/database.module.js';
import { IdempotencyModule } from '../platform/idempotency.module.js';
import { createOrderEvents, type OrderNotificationsFor } from './order-persistence.js';
import { OrderTransactions, toOrderResponse } from './order-transactions.js';
import { placeOrderJob } from './place-order.job.js';

export { ORDER_PLACED, OrderPlacedV1 } from './order-events.js';
export type { OrderNotificationsFor } from './order-persistence.js';
export { placeOrderJob } from './place-order.job.js';

const PlaceOrderDto = v.object({
  sku: v.pipe(v.string(), v.minLength(1)),
  quantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export const OrderDto = v.object({
  id: v.string(),
  sku: v.string(),
  quantity: v.number(),
  status: v.string(),
  createdAt: v.string(),
});

interface OrderServices {
  orderTransactions: OrderTransactions;
  requireAuth: AuthMiddlewareFactory;
}

const orderRoutes = createRoutes<OrderServices, AuthContext<AppUser>>((router, services, route) => {
  router.post(
    '/',
    ...route({
      operationId: 'placeOrder',
      summary: 'Place an order and reserve its stock',
      // No RLS middleware: the adapter binds the tenant from its input.
      middleware: [services.requireAuth()],
      // Checked on every request, so a replay needs the same permission as the original.
      authorize: { action: 'create', subject: 'Order' },
      body: PlaceOrderDto,
      responses: { 201: OrderDto },
      openapi: {
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description:
              'Repeating a request with the same key returns the first response instead of placing another order. Keys belong to the caller and expire after a day.',
            schema: { type: 'string', minLength: 1, maxLength: 255 },
          },
        ],
      },
      handler: async ({ body, user, context }) => {
        const input = {
          tenantId: user.tenantId,
          actorUserId: user.id,
          sku: body.sku,
          quantity: body.quantity,
        };
        const key = context.req.header('idempotency-key');
        if (key === undefined) {
          return toOrderResponse(await services.orderTransactions.placeOrder(input));
        }
        if (key.length === 0 || key.length > 255) {
          throw new BadRequestException('Idempotency-Key must be 1 to 255 characters');
        }

        const { replayed, order } = await services.orderTransactions.placeOrderOnce(input, {
          key,
          principalId: user.id,
        });
        if (replayed) context.header('Idempotent-Replayed', 'true');
        return order;
      },
    })
  );
});

export const OrdersModule = defineModule({
  name: 'orders',
  basePath: 'orders',
  imports: [DatabaseModule, AuditModule, AuthModule, InventoryModule, IdempotencyModule],
  providers: [
    OrderTransactions,
    {
      provide: 'orderNotificationsFor',
      useValue: createOrderEvents satisfies OrderNotificationsFor,
    },
  ],
  routes: orderRoutes,
  jobs: [placeOrderJob],
});
