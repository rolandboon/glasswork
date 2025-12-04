import type { TenantContext } from './types.js';

/**
 * Escape a SQL literal by doubling single quotes.
 * This prevents SQL injection in SET LOCAL statements.
 */
export function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Escape a SQL identifier by doubling double quotes.
 * This keeps session variable names safe to interpolate.
 */
export function escapeIdentifier(identifier: string): string {
  if (!identifier.trim()) {
    throw new Error('Session variable name cannot be empty');
  }

  return identifier.replaceAll('"', '""');
}

/**
 * Build a SET LOCAL statement for a session variable.
 */
export function formatSetStatement(variableName: string, value: string): string {
  return `SET LOCAL "${escapeIdentifier(variableName)}" = '${escapeLiteral(value)}'`;
}

/**
 * Lightweight runtime guard for TenantContext.
 */
export function isTenantContext(value: unknown): value is TenantContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const ctx = value as Record<string, unknown>;
  return (
    typeof ctx.tenantId === 'string' &&
    ctx.tenantId.length > 0 &&
    typeof ctx.userId === 'string' &&
    ctx.userId.length > 0 &&
    typeof ctx.role === 'string' &&
    ctx.role.length > 0
  );
}

/**
 * Ensure a tenant context is available, throwing a clear error if missing.
 */
export function assertTenantContext(value: unknown, label: string): TenantContext {
  if (!isTenantContext(value)) {
    throw new Error(`Tenant context "${label}" is required for RLS`);
  }

  return value;
}
