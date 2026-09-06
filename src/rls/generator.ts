import { validateSessionVariables } from './configuration.js';
import type { GenerateRLSPoliciesOptions } from './types.js';

/**
 * Escape a PostgreSQL identifier (table name or column name) by wrapping in double quotes.
 */
function quoteIdentifier(identifier: string): string {
  if (!identifier.trim()) {
    throw new Error('Identifier cannot be empty');
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Generate PostgreSQL Row Level Security DDL statements for a list of tables.
 *
 * @param options - Configuration options for policy generation.
 * @returns Formatted SQL migration string containing DDL statements.
 *
 * @example
 * ```typescript
 * const sql = generateRLSPolicies({
 *   models: ['Poll', 'MemberProfile'],
 *   tenantField: 'tenantId',
 * });
 * ```
 */
export function generateRLSPolicies(options: GenerateRLSPoliciesOptions): string {
  const {
    models,
    tenantField = 'tenantId',
    sessionVariable = 'app.current_tenant_id',
    bypassVariable,
    forceRLS = true,
  } = options;

  if (!models || models.length === 0) {
    return '';
  }

  const quotedTenantField = quoteIdentifier(tenantField);
  validateSessionVariables(sessionVariable, bypassVariable);

  const policyStatements = models.map((model) => {
    const quotedTable = quoteIdentifier(model);
    const policyName = quoteIdentifier(`tenant_isolation_${model}`);

    const condition = bypassVariable
      ? `current_setting('${bypassVariable}', true) = 'true' OR ${quotedTenantField} = NULLIF(current_setting('${sessionVariable}', true), '')`
      : `${quotedTenantField} = NULLIF(current_setting('${sessionVariable}', true), '')`;

    const lines: string[] = [`ALTER TABLE ${quotedTable} ENABLE ROW LEVEL SECURITY;`];

    if (forceRLS) {
      lines.push(`ALTER TABLE ${quotedTable} FORCE ROW LEVEL SECURITY;`);
    }

    lines.push(
      `DROP POLICY IF EXISTS ${policyName} ON ${quotedTable};`,
      `CREATE POLICY ${policyName} ON ${quotedTable}`,
      '  FOR ALL',
      `  USING (${condition})`,
      `  WITH CHECK (${condition});`
    );

    return lines.join('\n');
  });

  return policyStatements.join('\n\n');
}
