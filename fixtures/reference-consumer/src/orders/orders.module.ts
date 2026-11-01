import type { AuthContext } from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import * as v from 'valibot';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AuditModule } from '../platform/audit.module.js';
import { type AppUser, type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { DatabaseModule } from '../platform/database.module.js';
import { createPendingNotifications, type OrderNotificationsFor } from './order-persistence.js';
import { OrderTransactions } from './order-transactions.js';
import { placeOrderJob } from './place-order.job.js';

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
      authorize: { action: 'create', subject: 'Order' },
      body: PlaceOrderDto,
      responses: { 201: OrderDto },
      handler: ({ body, user }) => {
        return services.orderTransactions.placeOrder({
          tenantId: user.tenantId,
          actorUserId: user.id,
          sku: body.sku,
          quantity: body.quantity,
        });
      },
    })
  );
});

export const OrdersModule = defineModule({
  name: 'orders',
  basePath: 'orders',
  imports: [DatabaseModule, AuditModule, AuthModule, InventoryModule],
  providers: [
    OrderTransactions,
    {
      provide: 'orderNotificationsFor',
      useValue: createPendingNotifications satisfies OrderNotificationsFor,
    },
  ],
  routes: orderRoutes,
  jobs: [placeOrderJob],
});
