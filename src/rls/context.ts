import { AsyncLocalStorage } from 'node:async_hooks';
import { MissingTenantContextException, type TenantContext } from './types.js';

/**
 * AsyncLocalStorage instance holding the active TenantContext for the current execution chain.
 */
const tenantContextStorage = new AsyncLocalStorage<Readonly<TenantContext> | undefined>();

/**
 * Run an asynchronous function within a specific tenant context.
 *
 * @param context - The TenantContext to bind.
 * @param fn - The asynchronous callback function.
 * @returns The resolved return value of `fn`.
 *
 * @example
 * ```typescript
 * const result = await runWithTenant({ tenantId: 'tenant_123' }, async () => {
 *   return await prisma.poll.findMany();
 * });
 * ```
 */
export function runWithTenant<T>(
  context: TenantContext | undefined,
  fn: () => T | PromiseLike<T>
): Promise<T> {
  return tenantContextStorage.run(context && Object.freeze({ ...context }), async () => await fn());
}

/**
 * Run trusted system code with an explicit bypass.
 *
 * Only tables with a matching bypass policy allow access across tenants.
 */
export function runWithBypass<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return runWithTenant({ bypass: true }, fn);
}

/**
 * Get the current active TenantContext, or undefined if outside a tenant execution boundary.
 */
export function getTenantContext(): Readonly<TenantContext> | undefined {
  return tenantContextStorage.getStore();
}

/**
 * Get the current active tenant ID, or undefined if outside a tenant boundary.
 */
export function getTenantId(): string | undefined {
  return tenantContextStorage.getStore()?.tenantId;
}

/**
 * Get the current active tenant ID, throwing `MissingTenantContextException` if not present.
 *
 * @param modelName - Optional model name for descriptive error reporting.
 */
export function requireTenantId(modelName?: string): string {
  const context = getTenantContext();
  if (!context?.tenantId) {
    throw new MissingTenantContextException(modelName);
  }
  return context.tenantId;
}
