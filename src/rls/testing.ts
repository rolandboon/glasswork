import { runWithBypass, runWithTenant } from './context.js';
import type { TenantContext } from './types.js';

/**
 * Run a test or seed function within a specific tenant context.
 *
 * @param tenantId - The tenant identifier.
 * @param fn - The test function.
 * @returns The resolved return value of `fn`.
 *
 * @example
 * ```typescript
 * await withTenant('tenant_cwz', async () => {
 *   const polls = await pollService.list();
 *   expect(polls).toHaveLength(1);
 * });
 * ```
 */
export function withTenant<T>(
  tenantId: string,
  fn: () => T | PromiseLike<T>,
  options?: Omit<TenantContext, 'tenantId'>
): Promise<T> {
  return runWithTenant(
    {
      tenantId,
      ...options,
    },
    fn
  );
}

/**
 * Run a test with explicit bypass context.
 *
 * @param fn - The test function.
 */
export function withBypass<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return runWithBypass(fn);
}
