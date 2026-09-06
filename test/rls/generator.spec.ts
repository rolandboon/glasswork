import { describe, expect, it } from 'vitest';
import { generateRLSPolicies } from '../../src/rls/generator.js';

describe('RLS DDL Generator', () => {
  it('returns empty string when models array is empty', () => {
    expect(generateRLSPolicies({ models: [] })).toBe('');
  });

  it('generates standard RLS policies with FORCE ROW LEVEL SECURITY', () => {
    const sql = generateRLSPolicies({
      models: ['Poll', 'MemberProfile'],
    });

    expect(sql).toContain('ALTER TABLE "Poll" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Poll" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('DROP POLICY IF EXISTS "tenant_isolation_Poll" ON "Poll";');
    expect(sql).toContain('CREATE POLICY "tenant_isolation_Poll" ON "Poll"');
    expect(sql).toContain(
      "USING (\"tenantId\" = NULLIF(current_setting('app.current_tenant_id', true), ''))"
    );
    expect(sql).toContain(
      "WITH CHECK (\"tenantId\" = NULLIF(current_setting('app.current_tenant_id', true), ''))"
    );

    expect(sql).toContain('ALTER TABLE "MemberProfile" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "MemberProfile" FORCE ROW LEVEL SECURITY;');
  });

  it('omits FORCE ROW LEVEL SECURITY when forceRLS is false', () => {
    const sql = generateRLSPolicies({
      models: ['Poll'],
      forceRLS: false,
    });

    expect(sql).toContain('ALTER TABLE "Poll" ENABLE ROW LEVEL SECURITY;');
    expect(sql).not.toContain('FORCE ROW LEVEL SECURITY;');
  });

  it('supports custom tenantField and sessionVariable', () => {
    const sql = generateRLSPolicies({
      models: ['Workspace'],
      tenantField: 'organization_id',
      sessionVariable: 'my_app.tenant',
    });

    expect(sql).toContain(
      "USING (\"organization_id\" = NULLIF(current_setting('my_app.tenant', true), ''))"
    );
    expect(sql).toContain(
      "WITH CHECK (\"organization_id\" = NULLIF(current_setting('my_app.tenant', true), ''))"
    );
  });

  it('explicitly checks for the bypass value true', () => {
    const sql = generateRLSPolicies({
      models: ['AuditLog'],
      bypassVariable: 'app.bypass',
    });

    expect(sql).toContain("current_setting('app.bypass', true) = 'true'");
    expect(sql).toContain(
      "\"tenantId\" = NULLIF(current_setting('app.current_tenant_id', true), '')"
    );
  });

  it('rejects empty identifiers', () => {
    expect(() => generateRLSPolicies({ models: [' '] })).toThrow('Identifier cannot be empty');
    expect(() => generateRLSPolicies({ models: ['Poll'], tenantField: '' })).toThrow(
      'Identifier cannot be empty'
    );
  });

  it('quotes identifiers without unquoted comments', () => {
    const sql = generateRLSPolicies({
      models: ['Poll"\nDROP TABLE x; --'],
      tenantField: 'tenant"id',
    });
    expect(sql).toContain('ALTER TABLE "Poll""\nDROP TABLE x; --" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('"tenant""id"');
    expect(sql).not.toContain('-- Row Level Security');
  });

  it('rejects SQL in session variables', () => {
    expect(() =>
      generateRLSPolicies({ models: ['Project'], sessionVariable: "app.tenant'quoted" })
    ).toThrow();
    expect(() =>
      generateRLSPolicies({ models: ['Project'], bypassVariable: "app.bypass'quoted" })
    ).toThrow();
  });
});
