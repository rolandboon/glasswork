import { PrismaPg } from '@prisma/adapter-pg';
import { defineModule, type OnModuleDestroy } from 'glasswork/core';
import { createRLSExtension, type RLSTransactionClient } from 'glasswork/rls';
import { type AppConfig, ConfigModule } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export function createDatabase(config: AppConfig) {
  const base = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: config.get('databaseUrl'), max: 4 },
      { schema: config.get('databaseSchema') }
    ),
  });
  return base.$extends(createRLSExtension({ models: tenantModels }));
}

/** Tables with a tenant isolation policy. */
export const tenantModels = [
  'Project',
  'Invitation',
  'Order',
  'StockItem',
  'Reservation',
  'PointsEntry',
];

export type Database = ReturnType<typeof createDatabase>;

/** The client a callback transaction receives. */
export type Transaction = RLSTransactionClient<Database>;

/**
 * The model delegates that the root client and a transaction client share. A service typed
 * with it runs on whichever client its module gives it.
 */
export type DatabaseClient = Transaction;

/** Owns the connection pool that the `prisma` provider creates. */
export class DatabaseConnection implements OnModuleDestroy {
  readonly #prisma: Database;

  constructor({ prisma }: { prisma: Database }) {
    this.#prisma = prisma;
  }

  async onModuleDestroy() {
    await this.#prisma.$disconnect();
  }
}

export const DatabaseModule = defineModule({
  name: 'database',
  imports: [ConfigModule],
  providers: [
    {
      provide: 'prisma',
      useFactory: ({ config }: { config: AppConfig }) => createDatabase(config),
    },
    DatabaseConnection,
  ],
  exports: ['prisma'],
});
