import type { PrismaClient } from '@prisma/client';
import type { ProviderConfig } from '../core/types.js';
import { createRLSClient } from './client.js';
import type { RLSProviderOptions } from './types.js';
import { assertTenantContext } from './utils.js';

/**
 * Create an Awilix provider that returns a tenant-scoped Prisma client.
 */
export function createRLSProvider(options: RLSProviderOptions = {}): ProviderConfig {
  const {
    provide = 'tenantPrisma',
    clientToken = 'prismaService',
    clientProperty = 'client',
    contextToken = 'tenantContext',
    config,
  } = options;

  return {
    provide,
    useFactory: (dependencies) => {
      const prisma = resolvePrismaClient(dependencies[clientToken], clientProperty, clientToken);
      const tenantContext = assertTenantContext(dependencies[contextToken], contextToken);
      return createRLSClient(prisma, tenantContext, config);
    },
    inject: [clientToken, contextToken],
    scope: 'SCOPED',
  };
}

function resolvePrismaClient(
  candidate: unknown,
  clientProperty: string | undefined,
  token: string
): PrismaClient {
  if (clientProperty && candidate && typeof candidate === 'object') {
    const value = (candidate as Record<string, unknown>)[clientProperty];
    if (isPrismaLike(value)) {
      return value;
    }
  }

  if (isPrismaLike(candidate)) {
    return candidate;
  }

  throw new Error(`Dependency "${token}" does not expose a Prisma client`);
}

function isPrismaLike(value: unknown): value is PrismaClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$extends' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).$extends === 'function' &&
    '$transaction' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).$transaction === 'function' &&
    '$executeRawUnsafe' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).$executeRawUnsafe === 'function'
  );
}

/**
 * @internal Exported for testing.
 */
export const __private__ = {
  isPrismaLike,
  resolvePrismaClient,
};
