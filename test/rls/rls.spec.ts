import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import * as rlsClient from '../../src/rls/client.js';
import {
  createAdminClient,
  createRLSClient,
  createRLSProvider,
  rlsMiddleware,
  seedTenant,
  withTenant,
} from '../../src/rls/index.js';
import type { RLSProviderOptions, TenantContext } from '../../src/rls/types.js';

type MockOperation = ReturnType<typeof vi.fn>;

interface MockTransactionClient {
  $executeRawUnsafe: MockOperation;
  project: {
    findMany: MockOperation;
    deleteMany: MockOperation;
  };
}

interface MockPrismaClient {
  project: {
    findMany: MockOperation;
    deleteMany: MockOperation;
  };
  $executeRawUnsafe: MockOperation;
  $transaction: MockOperation;
  $extends: (extension: {
    query: {
      $allOperations: (input: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  }) => unknown;
}

function createMockPrisma() {
  const baseQuery = vi.fn().mockResolvedValue('base-query');
  const tx: MockTransactionClient = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    project: {
      findMany: vi.fn().mockResolvedValue('tx-result'),
      deleteMany: vi.fn().mockResolvedValue('tx-deleted'),
    },
  };

  const prisma: MockPrismaClient = {
    project: {
      findMany: vi.fn().mockResolvedValue('base-result'),
      deleteMany: vi.fn().mockResolvedValue('base-deleted'),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (callback: (client: MockTransactionClient) => unknown) =>
      callback(tx)
    ),
    $extends: (extension) => {
      const callOperation = (operation: string, args: unknown, model?: string) =>
        extension.query.$allOperations({
          model: model ?? 'project',
          operation,
          args,
          query: baseQuery,
        });

      return {
        project: {
          findMany: (args?: unknown) => callOperation('findMany', args),
          deleteMany: (args?: unknown) => callOperation('deleteMany', args),
        },
      };
    },
  };

  return { prisma, tx, baseQuery };
}

describe('createRLSClient', () => {
  it('wraps queries in a transaction and sets session variables', async () => {
    const { prisma, tx } = createMockPrisma();

    const client = createRLSClient(prisma as unknown as PrismaClient, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });

    const extended = client as unknown as {
      project: { findMany: (args?: unknown) => Promise<unknown> };
    };

    const result = await extended.project.findMany({ where: { id: 1 } });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'SET LOCAL "app.tenant_id" = \'tenant-1\''
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(2, 'SET LOCAL "app.user_id" = \'user-1\'');
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      'SET LOCAL "app.user_role" = \'member\''
    );
    expect(tx.project.findMany).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(result).toBe('tx-result');
  });

  it('supports disabling transaction wrapping', async () => {
    const { prisma, baseQuery } = createMockPrisma();

    const client = createRLSClient(
      prisma as unknown as PrismaClient,
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'member',
      },
      { useTransaction: false }
    );

    const extended = client as unknown as {
      project: { findMany: (args?: unknown) => Promise<unknown> };
    };

    const result = await extended.project.findMany({ take: 5 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(baseQuery).toHaveBeenCalledWith({ take: 5 });
    expect(result).toBe('base-query');
  });

  it('escapes tenant values to prevent SQL injection', async () => {
    const { prisma, tx } = createMockPrisma();

    const client = createRLSClient(prisma as unknown as PrismaClient, {
      tenantId: "tenant-'1",
      userId: "user-'1",
      role: "role-'1",
    });

    const extended = client as unknown as {
      project: { deleteMany: (args?: unknown) => Promise<unknown> };
    };

    await extended.project.deleteMany({ where: { id: 1 } });

    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      "SET LOCAL \"app.tenant_id\" = 'tenant-''1'"
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      "SET LOCAL \"app.user_id\" = 'user-''1'"
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      "SET LOCAL \"app.user_role\" = 'role-''1'"
    );
  });
});

describe('createAdminClient', () => {
  it('sets bypass flag before executing queries', async () => {
    const { prisma, tx } = createMockPrisma();

    const client = createAdminClient(prisma as unknown as PrismaClient);
    const extended = client as unknown as {
      project: { findMany: (args?: unknown) => Promise<unknown> };
    };

    await extended.project.findMany();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL "app.bypass_rls" = \'true\'');
  });
});

describe('createRLSProvider', () => {
  it('builds a scoped provider that resolves a Prisma client', () => {
    const { prisma } = createMockPrisma();
    const tenantContext: TenantContext = { tenantId: 't', userId: 'u', role: 'admin' };
    const providerOptions: RLSProviderOptions = {};
    const provider = createRLSProvider(providerOptions);
    const scopedClient = { scoped: true };

    const spy = vi
      .spyOn(rlsClient, 'createRLSClient')
      // biome-ignore lint/suspicious/noExplicitAny: vi spy return type
      .mockReturnValue(scopedClient as any);

    const resolved = provider.useFactory?.({
      prismaService: prisma,
      tenantContext,
    } as Record<string, unknown>);

    expect(provider.scope).toBe('SCOPED');
    expect(provider.inject).toEqual(['prismaService', 'tenantContext']);
    expect(spy).toHaveBeenCalledWith(prisma, tenantContext, undefined);
    expect(resolved).toBe(scopedClient);

    spy.mockRestore();
  });
});

describe('rlsMiddleware', () => {
  it('stores tenant context from auth data', async () => {
    const auth: TenantContext = { tenantId: 't', userId: 'u', role: 'member' };
    const set = vi.fn();
    const context = {
      get: vi.fn((key: string) => (key === 'auth' ? auth : undefined)),
      set,
    };
    const next = vi.fn();

    await rlsMiddleware()(context as unknown as Parameters<typeof rlsMiddleware>[0], next);

    expect(set).toHaveBeenCalledWith('tenantContext', auth);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests without tenant when configured', async () => {
    const set = vi.fn();
    const context = {
      get: vi.fn(() => undefined),
      set,
    };
    const next = vi.fn();

    await rlsMiddleware({ allowUnauthenticated: true })(
      context as unknown as Parameters<typeof rlsMiddleware>[0],
      next
    );

    expect(set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('testing utilities', () => {
  it('withTenant creates scoped client and passes it to callback', async () => {
    const { prisma } = createMockPrisma();
    const scopedClient = { scoped: true };
    const spy = vi
      .spyOn(rlsClient, 'createRLSClient')
      // biome-ignore lint/suspicious/noExplicitAny: vi spy return type
      .mockReturnValue(scopedClient as any);

    const result = await withTenant(
      prisma as unknown as PrismaClient,
      'tenant-42',
      async (client) => {
        expect(client).toBe(scopedClient);
        return 'ok';
      }
    );

    expect(result).toBe('ok');
    expect(spy).toHaveBeenCalledWith(
      prisma,
      { tenantId: 'tenant-42', userId: 'test-user', role: 'admin' },
      undefined
    );

    spy.mockRestore();
  });

  it('seedTenant sets bypass and tenant variables and runs seed callback', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      project: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await seedTenant(prisma as unknown as PrismaClient, 'tenant-seed', async (client) => {
      await client.project.create({ data: { id: 1 } });
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'SET LOCAL "app.bypass_rls" = \'true\''
    );
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      'SET LOCAL "app.tenant_id" = \'tenant-seed\''
    );
    expect(tx.project.create).toHaveBeenCalledWith({ data: { id: 1 } });
  });
});
