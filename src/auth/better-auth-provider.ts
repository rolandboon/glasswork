import type { AuthProvider, AuthSession, AuthUser } from './types.js';

export interface BetterAuthClient {
  $context?: Promise<{ authCookies: { sessionToken: { name: string } } }>;
  api: {
    getSession: (options: { headers?: Record<string, string> }) => Promise<{
      session?: BetterAuthSession | null;
      user?: Record<string, unknown> | null;
    } | null>;
    revokeSession: (options: {
      body: { token: string };
      headers: Record<string, string>;
    }) => Promise<unknown>;
    signInEmail?: (options: { body: { email: string; password: string } }) => Promise<unknown>;
    signUpEmail?: (options: { body: Record<string, unknown> }) => Promise<unknown>;
    signInSocial?:
      | ((options: { body: Record<string, unknown> }) => Promise<unknown>)
      | (Promise<unknown> & {
          callback?: (options: { query: Record<string, unknown> }) => Promise<unknown>;
        });
  };
  handler?: (request: Request) => Promise<Response>;
}

export interface BetterAuthProviderConfig<TUser extends AuthUser = AuthUser> {
  /** better-auth client instance */
  auth: BetterAuthClient;
  /** Map better-auth user to AuthUser */
  mapUser?: (user: Record<string, unknown>) => TUser;
  /** Override the cookie name. Otherwise use Better Auth's resolved cookie configuration. */
  cookieName?: string;
}

interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: string | Date;
  createdAt: string | Date;
  lastAccessedAt?: string | Date;
  token?: string;
  [key: string]: unknown;
}

const DEFAULT_COOKIE_NAME = 'better-auth.session_token';

/**
 * Wrap better-auth as a Glasswork AuthProvider.
 */
export function createBetterAuthProvider<TUser extends AuthUser>(
  config: BetterAuthProviderConfig<TUser> & {
    mapUser: (user: Record<string, unknown>) => TUser;
  }
): AuthProvider<TUser>;
export function createBetterAuthProvider(
  config: BetterAuthProviderConfig<AuthUser>
): AuthProvider<AuthUser>;
export function createBetterAuthProvider(
  config: BetterAuthProviderConfig<AuthUser>
): AuthProvider<AuthUser> {
  const { auth, mapUser, cookieName } = config;
  const getSessionCookieName = async (): Promise<string> =>
    cookieName ?? (await auth.$context)?.authCookies.sessionToken.name ?? DEFAULT_COOKIE_NAME;

  const defaultMapUser = (user: Record<string, unknown>): AuthUser => ({
    ...user,
    id: String(user.id ?? user.userId ?? ''),
    email: typeof user.email === 'string' ? user.email : undefined,
    role: (user.role as string) ?? 'user',
    tenantId: (user.tenantId as string | undefined) ?? (user.organizationId as string | undefined),
  });

  return {
    name: 'better-auth',
    sessionCookieName: cookieName ?? DEFAULT_COOKIE_NAME,
    getSessionCookieName,

    async validateSession(token: string) {
      try {
        const result = await auth.api.getSession({
          headers: { cookie: `${await getSessionCookieName()}=${token}` },
        });

        if (!result?.session || !result.user) {
          return null;
        }

        return {
          session: mapSession(result.session),
          user: (mapUser ?? defaultMapUser)(result.user),
        };
      } catch {
        return null;
      }
    },

    async invalidateSession(token: string) {
      const headers = { cookie: `${await getSessionCookieName()}=${token}` };
      const result = await auth.api.getSession({ headers });
      const sessionToken = result?.session?.token;

      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        return;
      }

      await auth.api.revokeSession({ body: { token: sessionToken }, headers });
    },

    async refreshSession(token: string) {
      try {
        const result = await auth.api.getSession({
          headers: { cookie: `${await getSessionCookieName()}=${token}` },
        });
        return result?.session ? mapSession(result.session) : null;
      } catch {
        return null;
      }
    },
  };
}

function mapSession(session: BetterAuthSession): AuthSession {
  return {
    id: String(session.id),
    userId: String(session.userId),
    expiresAt: toDate(session.expiresAt),
    createdAt: toDate(session.createdAt),
    lastAccessedAt: session.lastAccessedAt ? toDate(session.lastAccessedAt) : undefined,
    impersonatedBy: typeof session.impersonatedBy === 'string' ? session.impersonatedBy : undefined,
    metadata: session,
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
