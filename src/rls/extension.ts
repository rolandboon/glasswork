import { Prisma } from '@prisma/client/extension';
import { validateSessionVariables } from './configuration.js';
import { getTenantContext, runWithTenant } from './context.js';
import {
  MissingTenantContextException,
  RLSConfigurationException,
  type RLSExtensionOptions,
  type RLSTransactionClient,
  type RLSTransactionOptions,
  type TenantContext,
} from './types.js';

// The generic @prisma/client/extension types do not include raw query methods.
// This is the public Prisma API; the generated client provides the implementation.
interface RawExecutor {
  $executeRawUnsafe(query: string, ...values: unknown[]): Prisma.PrismaPromise<number>;
}

/** Prisma extension for transaction-scoped PostgreSQL RLS. Apply this extension last. */
export function createRLSExtension(options: RLSExtensionOptions = {}) {
  const {
    sessionVariable = 'app.current_tenant_id',
    bypassVariable,
    models,
    missingContextBehavior = 'throw',
  } = options;

  validateSessionVariables(sessionVariable, bypassVariable);

  function resolveContext(model?: string): Readonly<TenantContext> | undefined {
    const context = getTenantContext();
    if (context?.bypass && !bypassVariable) {
      throw new RLSConfigurationException('This RLS extension does not allow bypass.');
    }
    if (context?.tenantId || context?.bypass) return context;
    if (
      missingContextBehavior === 'throw' &&
      (!models || (model !== undefined && models.includes(model)))
    ) {
      throw new MissingTenantContextException(model);
    }
    return undefined;
  }

  return Prisma.defineExtension((base) => {
    function sessionConfig(context: Readonly<TenantContext>): [string, ...string[]] {
      const tenantId = context.tenantId ?? '';
      // Set or clear both settings each time; values remain parameterized.
      return bypassVariable
        ? [
            'SELECT set_config($1, $2, true), set_config($3, $4, true)',
            sessionVariable,
            tenantId,
            bypassVariable,
            context.bypass ? 'true' : '',
          ]
        : ['SELECT set_config($1, $2, true)', sessionVariable, tenantId];
    }

    async function transact<TClient, TResult>(
      fn: (tx: RLSTransactionClient<TClient>) => Promise<TResult>,
      transactionOptions?: RLSTransactionOptions
    ): Promise<TResult> {
      if (typeof fn !== 'function') {
        throw new RLSConfigurationException('Use the callback form of $transaction for RLS.');
      }
      const context = resolveContext();
      if (!context) throw new MissingTenantContextException();

      // A separate extension keeps Prisma's query callback on the transaction client.
      // No private Prisma transaction fields or global client redirection are needed.
      const transactional = base.$extends({
        name: 'glasswork-rls-transaction',
        query: {
          async $allOperations({ model, args, query }) {
            const active = resolveContext(model);
            if (active?.tenantId !== context.tenantId || active?.bypass !== context.bypass) {
              throw new RLSConfigurationException(
                'The RLS context cannot change within a transaction.'
              );
            }
            return query(args);
          },
        },
      });

      return transactional.$transaction(async (tx) => {
        await (tx as typeof tx & RawExecutor).$executeRawUnsafe(...sessionConfig(context));
        // Prisma preserves the model delegates and previously applied extensions.
        return fn(tx as unknown as RLSTransactionClient<TClient>);
      }, transactionOptions);
    }

    return base.$extends({
      name: 'glasswork-rls',
      client: {
        $transaction<TClient, TResult>(
          this: TClient,
          fn: (tx: RLSTransactionClient<TClient>) => Promise<TResult>,
          transactionOptions?: RLSTransactionOptions
        ) {
          return transact(fn, transactionOptions);
        },
        $withTenant<TClient, TResult>(
          this: TClient,
          context: TenantContext,
          fn: (tx: RLSTransactionClient<TClient>) => Promise<TResult>,
          transactionOptions?: RLSTransactionOptions
        ) {
          return runWithTenant(context, () => transact(fn, transactionOptions));
        },
      },
      query: {
        async $allOperations({ model, args, query }) {
          const context = resolveContext(model);
          if (!context) return query(args);
          // A batch binds the original PrismaPromise to the same connection.
          // Global models can also load tenant relations: scope every query.
          const operation = query(args) as Prisma.PrismaPromise<unknown>;
          const [, result] = await base.$transaction([
            (base as typeof base & RawExecutor).$executeRawUnsafe(...sessionConfig(context)),
            operation,
          ]);
          return result;
        },
      },
    });
  });
}
