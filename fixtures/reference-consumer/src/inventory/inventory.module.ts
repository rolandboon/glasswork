import { defineModule } from 'glasswork/core';
import { createRoutes, NotFoundException } from 'glasswork/http';
import { createRLSMiddleware } from 'glasswork/rls';
import * as v from 'valibot';
import { type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { DatabaseModule, type Transaction } from '../platform/database.module.js';
import { InventoryService } from './inventory.service.js';

export { InsufficientStockError, type ReserveInput } from './inventory.service.js';

/** Gives a use case the inventory service on its transaction client. */
export type InventoryFor = (tx: Transaction) => InventoryService;

const StockDto = v.object({ sku: v.string(), available: v.number() });

interface InventoryServices {
  inventoryService: InventoryService;
  requireAuth: AuthMiddlewareFactory;
}

const inventoryRoutes = createRoutes<InventoryServices>((router, services, route) => {
  router.get(
    '/:sku',
    ...route({
      operationId: 'getStock',
      summary: 'Show the available stock of a SKU',
      middleware: [services.requireAuth(), createRLSMiddleware()],
      params: v.object({ sku: v.string() }),
      responses: { 200: StockDto },
      handler: async ({ params }) => {
        const item = await services.inventoryService.find(params.sku);
        if (!item) throw new NotFoundException('Unknown SKU');
        return item;
      },
    })
  );
});

export const InventoryModule = defineModule({
  name: 'inventory',
  basePath: 'inventory',
  imports: [DatabaseModule, AuthModule],
  providers: [
    // On the root client, for reads outside a use case.
    InventoryService,
    {
      provide: 'inventoryFor',
      useValue: ((tx) => new InventoryService({ prisma: tx })) satisfies InventoryFor,
    },
  ],
  exports: ['inventoryFor'],
  routes: inventoryRoutes,
});
