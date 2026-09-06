import type { Context } from 'hono';
import { type DomainExceptionOptions, ForbiddenException } from '../http/errors.js';

/** Trusted server context; bypass is an explicit permission, not a secret. */
export interface TenantContext {
  tenantId?: string;
  userId?: string;
  role?: string;
  bypass?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RLSExtensionOptions {
  /** PostgreSQL tenant setting. Default: app.current_tenant_id. */
  sessionVariable?: string;
  /** Optional bypass setting. Only the value 'true' activates matching policies. */
  bypassVariable?: string;
  /** Prisma model names that require context. Default: all models. */
  models?: readonly string[];
  /** Defaults to 'throw'. With 'ignore', PostgreSQL remains responsible for denying access. */
  missingContextBehavior?: 'throw' | 'ignore';
}

/** Public Prisma transaction options. */
export interface RLSTransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

export type RLSTransactionClient<TClient> = Omit<
  TClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$withTenant'
>;

export type TenantContextExtractor = (
  context: Context
) => TenantContext | undefined | Promise<TenantContext | undefined>;

export interface RLSMiddlewareOptions {
  extractTenant?: TenantContextExtractor;
  /** Allow public requests without a tenant. Default: true. */
  allowUnauthenticated?: boolean;
}

export interface GenerateRLSPoliciesOptions {
  /** SQL table names, respecting Prisma @@map. */
  models: readonly string[];
  /** SQL column name, respecting Prisma @map. Default: tenantId. */
  tenantField?: string;
  sessionVariable?: string;
  /** Only specify for tables that explicitly allow bypass. */
  bypassVariable?: string;
  /** Enforce RLS for the table owner as well. Default: true. */
  forceRLS?: boolean;
}

export class MissingTenantContextException extends ForbiddenException {
  constructor(modelName?: string, options?: DomainExceptionOptions) {
    super(
      modelName
        ? `Missing tenant context for tenant-scoped model "${modelName}". Operation rejected by RLS guard.`
        : 'Missing tenant context. Operation rejected by RLS guard.',
      options
    );
    this.name = 'MissingTenantContextException';
  }
}

export class RLSConfigurationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RLSConfigurationException';
  }
}
