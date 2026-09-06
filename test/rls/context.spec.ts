import { describe, expect, it } from 'vitest';
import {
  getTenantContext,
  getTenantId,
  requireTenantId,
  runWithBypass,
  runWithTenant,
} from '../../src/rls/context.js';
import { MissingTenantContextException } from '../../src/rls/types.js';

describe('RLS Context (AsyncLocalStorage)', () => {
  it('returns undefined when no tenant context is active', () => {
    expect(getTenantContext()).toBeUndefined();
    expect(getTenantId()).toBeUndefined();
  });

  it('binds tenant context within runWithTenant', async () => {
    const context = {
      tenantId: 'tenant_cwz',
      userId: 'user_1',
      role: 'admin',
    };

    const result = await runWithTenant(context, async () => {
      expect(getTenantContext()).toEqual(context);
      expect(getTenantId()).toBe('tenant_cwz');
      return 'success';
    });

    expect(result).toBe('success');
    expect(getTenantContext()).toBeUndefined();
  });

  it('handles nested runWithTenant boundaries correctly', async () => {
    await runWithTenant({ tenantId: 'tenant_outer' }, async () => {
      expect(getTenantId()).toBe('tenant_outer');

      await runWithTenant({ tenantId: 'tenant_inner' }, async () => {
        expect(getTenantId()).toBe('tenant_inner');
      });

      expect(getTenantId()).toBe('tenant_outer');
    });

    expect(getTenantId()).toBeUndefined();
  });

  it('activates bypass without a fictitious tenant', async () => {
    await runWithBypass(async () => {
      const ctx = getTenantContext();
      expect(ctx?.tenantId).toBeUndefined();
      expect(ctx?.bypass).toBe(true);
      expect(() => requireTenantId()).toThrow(MissingTenantContextException);
    });

    expect(getTenantContext()).toBeUndefined();
  });

  it('requireTenantId returns tenantId when present', async () => {
    await runWithTenant({ tenantId: 'tenant_cwz' }, async () => {
      expect(requireTenantId()).toBe('tenant_cwz');
    });
  });

  it('requireTenantId throws MissingTenantContextException when missing', () => {
    expect(() => requireTenantId('Poll')).toThrow(MissingTenantContextException);
    try {
      requireTenantId('Poll');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTenantContextException);
      expect((error as MissingTenantContextException).message).toContain('Poll');
    }
  });
});
