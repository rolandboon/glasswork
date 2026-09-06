import { describe, expect, it } from 'vitest';
import { getTenantContext, requireTenantId, runWithTenant } from '../../src/rls/context.js';
import { withBypass, withTenant } from '../../src/rls/testing.js';

describe('RLS test helpers', () => {
  it('passes through metadata and the callback result', async () => {
    const result = await withTenant(
      'a',
      async () => {
        expect(getTenantContext()).toEqual({ tenantId: 'a', userId: 'u', role: 'member' });
        return 42;
      },
      { userId: 'u', role: 'member' }
    );
    expect(result).toBe(42);
    expect(getTenantContext()).toBeUndefined();
  });

  it('restores the outer context after a failed bypass', async () => {
    await withTenant('a', async () => {
      await expect(
        withBypass(async () => {
          expect(getTenantContext()).toEqual({ bypass: true });
          throw new Error('failed');
        })
      ).rejects.toThrow('failed');
      expect(requireTenantId()).toBe('a');
    });
  });

  it('copies tenant context to prevent changes by the caller', async () => {
    const context = { tenantId: 'a' };
    await runWithTenant(context, async () => {
      context.tenantId = 'b';
      expect(requireTenantId()).toBe('a');
      expect(Object.isFrozen(getTenantContext())).toBe(true);
    });
  });
});
