import type { PrismaClient } from '@prisma/client';
import type { RLSConfig, SessionVariableNames, TenantContext } from './types.js';
import { assertTenantContext, formatSetStatement } from './utils.js';

const DEFAULT_SESSION_VARIABLES: SessionVariableNames = {
  tenantId: 'app.tenant_id',
  userId: 'app.user_id',
  role: 'app.user_role',
  bypass: 'app.bypass_rls',
};

const DEFAULT_CONFIG: RLSConfig = {
  sessionVariables: DEFAULT_SESSION_VARIABLES,
  useTransaction: true,
};

type RawExecutor = {
  $executeRawUnsafe: (query: string) => Promise<unknown>;
};

type OperationInvoker = (args: unknown) => unknown;

/**
 * Create a Prisma client extension that sets RLS session variables
 * for every query.
 */
export function createRLSClient<TClient extends PrismaClient>(
  prisma: TClient,
  context: TenantContext,
  config?: Partial<RLSConfig>
): TClient {
  const mergedConfig = buildConfig(config);
  const tenantContext = assertTenantContext(context, 'tenantContext');
  const statements = createStatements(tenantContext, mergedConfig.sessionVariables);

  return prisma.$extends({
    name: 'rls',
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (mergedConfig.useTransaction) {
          return prisma.$transaction(async (tx) => {
            await applyStatements(tx, statements);
            const operationFn = findOperation(tx, model, operation);
            if (operationFn) {
              return operationFn(args);
            }
            return query(args);
          });
        }

        await applyStatements(prisma, statements);
        return query(args);
      },
    },
  }) as TClient;
}

export interface AdminClientOptions {
  bypassVariable?: string;
  useTransaction?: boolean;
}

/**
 * Create a Prisma client that sets a bypass flag for administrative operations.
 */
export function createAdminClient<TClient extends PrismaClient>(
  prisma: TClient,
  options: AdminClientOptions = {}
): TClient {
  const bypassVariable =
    options.bypassVariable ?? DEFAULT_SESSION_VARIABLES.bypass ?? 'app.bypass_rls';
  const useTransaction = options.useTransaction ?? true;
  const statements = [formatSetStatement(bypassVariable, 'true')];

  return prisma.$extends({
    name: 'rls-admin-bypass',
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (useTransaction) {
          return prisma.$transaction(async (tx) => {
            await applyStatements(tx, statements);
            const operationFn = findOperation(tx, model, operation);
            if (operationFn) {
              return operationFn(args);
            }
            return query(args);
          });
        }

        await applyStatements(prisma, statements);
        return query(args);
      },
    },
  }) as TClient;
}

function buildConfig(config?: Partial<RLSConfig>): RLSConfig {
  return {
    sessionVariables: {
      ...DEFAULT_SESSION_VARIABLES,
      ...config?.sessionVariables,
    },
    useTransaction: config?.useTransaction ?? DEFAULT_CONFIG.useTransaction,
  };
}

function createStatements(
  context: TenantContext,
  sessionVariables: SessionVariableNames
): string[] {
  return [
    formatSetStatement(sessionVariables.tenantId, context.tenantId),
    formatSetStatement(sessionVariables.userId, context.userId),
    formatSetStatement(sessionVariables.role, context.role),
  ];
}

async function applyStatements(target: RawExecutor, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await target.$executeRawUnsafe(statement);
  }
}

function findOperation(
  client: unknown,
  model: string | undefined,
  operation: string
): OperationInvoker | undefined {
  if (!client || typeof client !== 'object') {
    return undefined;
  }

  const scope = model ? (client as Record<string, unknown>)[model] : client;

  if (!scope || typeof scope !== 'object') {
    return undefined;
  }

  const candidate = (scope as Record<string, unknown>)[operation];
  return typeof candidate === 'function' ? (candidate as OperationInvoker) : undefined;
}

/**
 * @internal Exported for test utilities.
 */
export const __private__ = {
  buildConfig,
  createStatements,
  applyStatements,
  findOperation,
};
