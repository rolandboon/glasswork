import type { Context } from 'hono';

export type TenantRole = 'admin' | 'member' | 'viewer' | (string & {});

/**
 * Tenant context extracted from authentication/session state.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: TenantRole;
}

/**
 * Names of PostgreSQL session variables used for RLS.
 */
export interface SessionVariableNames {
  tenantId: string;
  userId: string;
  role: string;
  bypass?: string;
}

/**
 * Configuration for the RLS Prisma extension.
 */
export interface RLSConfig {
  sessionVariables: SessionVariableNames;
  useTransaction: boolean;
}

/**
 * Options for building an Awilix provider that scopes Prisma per request.
 */
export interface RLSProviderOptions {
  /**
   * Token to register in the container (default: "tenantPrisma").
   */
  provide?: string;
  /**
   * Token that resolves to the base Prisma client or a service exposing it.
   * Defaults to "prismaService".
   */
  clientToken?: string;
  /**
   * Property on the injected service that contains the Prisma client.
   * Defaults to "client". Set to undefined if the token is the Prisma client itself.
   */
  clientProperty?: string;
  /**
   * Token that contains the current tenant context.
   * Defaults to "tenantContext".
   */
  contextToken?: string;
  /**
   * Optional overrides for the RLS configuration.
   */
  config?: Partial<RLSConfig>;
}

export type TenantContextExtractor = (
  context: Context
) => TenantContext | undefined | Promise<TenantContext | undefined>;

export interface RLSMiddlewareOptions {
  contextKey?: string;
  extractTenant?: TenantContextExtractor;
  allowUnauthenticated?: boolean;
}

export interface WithTenantOptions {
  config?: Partial<RLSConfig>;
}

export interface SeedTenantOptions {
  bypassVariable?: string;
  tenantVariable?: string;
}
