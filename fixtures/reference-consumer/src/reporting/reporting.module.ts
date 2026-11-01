import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { createRLSMiddleware } from 'glasswork/rls';
import * as v from 'valibot';
import { type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { type Database, DatabaseModule } from '../platform/database.module.js';

const OrderReportRow = v.object({
  orderId: v.string(),
  sku: v.string(),
  quantity: v.number(),
  status: v.string(),
  reserved: v.number(),
});

/**
 * A read model across the orders and inventory tables. It is the one deliberate exception
 * to table ownership: it only reads, and the boundary test lists it. Writes stay with the
 * owning modules.
 */
export class OrderReport {
  readonly #prisma: Database;

  constructor({ prisma }: { prisma: Database }) {
    this.#prisma = prisma;
  }

  async rows() {
    const [orders, reservations] = await Promise.all([
      this.#prisma.order.findMany({ orderBy: { createdAt: 'asc' } }),
      this.#prisma.reservation.findMany(),
    ]);
    return orders.map((order) => ({
      orderId: order.id,
      sku: order.sku,
      quantity: order.quantity,
      status: order.status,
      reserved: reservations
        .filter((reservation) => reservation.orderId === order.id)
        .reduce((sum, reservation) => sum + reservation.quantity, 0),
    }));
  }
}

interface ReportingServices {
  orderReport: OrderReport;
  requireAuth: AuthMiddlewareFactory;
}

const reportingRoutes = createRoutes<ReportingServices>((router, services, route) => {
  router.get(
    '/orders',
    ...route({
      operationId: 'getOrderReport',
      summary: 'Orders with their reserved quantities',
      middleware: [services.requireAuth(), createRLSMiddleware()],
      responses: { 200: v.array(OrderReportRow) },
      handler: () => services.orderReport.rows(),
    })
  );
});

export const ReportingModule = defineModule({
  name: 'reporting',
  basePath: 'reports',
  imports: [DatabaseModule, AuthModule],
  providers: [OrderReport],
  routes: reportingRoutes,
});
