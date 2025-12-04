import type { PrismaClient } from '@prisma/client';
import { createRLSClient } from './client.js';
import type { SeedTenantOptions, TenantContext, WithTenantOptions } from './types.js';
import { formatSetStatement } from './utils.js';

/**
 * Execute a function with a tenant-scoped Prisma client.
 */
export async function withTenant<TResult>(
  prisma: PrismaClient,
  tenant: TenantContext | string,
  callback: (client: PrismaClient) => Promise<TResult>,
  options: WithTenantOptions = {}
): Promise<TResult> {
  const tenantContext: TenantContext =
    typeof tenant === 'string' ? { tenantId: tenant, userId: 'test-user', role: 'admin' } : tenant;

  const scopedClient = createRLSClient(prisma, tenantContext, options.config);
  return callback(scopedClient);
}

/**
 * Seed data for a specific tenant using a bypass client and session variables.
 */
export async function seedTenant(
  prisma: PrismaClient,
  tenantId: string,
  seed: (client: PrismaClient) => Promise<void>,
  options: SeedTenantOptions = {}
): Promise<void> {
  const bypassVariable = options.bypassVariable ?? 'app.bypass_rls';
  const tenantVariable = options.tenantVariable ?? 'app.tenant_id';

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(formatSetStatement(bypassVariable, 'true'));
    await tx.$executeRawUnsafe(formatSetStatement(tenantVariable, tenantId));
    await seed(tx);
  });
}
