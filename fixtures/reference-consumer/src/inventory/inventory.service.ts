import { randomUUID } from 'node:crypto';
import { ConflictException } from 'glasswork/http';
import type { DatabaseClient } from '../platform/database.module.js';

export class InsufficientStockError extends ConflictException {
  constructor(sku: string, quantity: number) {
    super(`Not enough stock to reserve ${quantity} of ${sku}`, { errorCode: 'insufficient-stock' });
  }
}

export interface ReserveInput {
  tenantId: string;
  orderId: string;
  sku: string;
  quantity: number;
}

/**
 * Stock levels and reservations, written the way many existing services are: it receives
 * a Prisma client and queries it directly. Typed with `DatabaseClient`, it runs on the root
 * client for plain reads and on a transaction client when a use case binds it.
 */
export class InventoryService {
  readonly #prisma: DatabaseClient;

  constructor({ prisma }: { prisma: DatabaseClient }) {
    this.#prisma = prisma;
  }

  find(sku: string) {
    return this.#prisma.stockItem.findFirst({ where: { sku } });
  }

  /** Decrements the stock only when enough is available, in one conditional update. */
  async reserve(input: ReserveInput) {
    const { count } = await this.#prisma.stockItem.updateMany({
      where: { sku: input.sku, available: { gte: input.quantity } },
      data: { available: { decrement: input.quantity } },
    });
    if (count === 0) throw new InsufficientStockError(input.sku, input.quantity);

    return this.#prisma.reservation.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        orderId: input.orderId,
        sku: input.sku,
        quantity: input.quantity,
      },
    });
  }
}
