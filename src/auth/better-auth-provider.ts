import type { AuthProvider, AuthSession, AuthUser } from './types.js';

export interface BetterAuthClient {
  api: {
    getSession: (options: { headers?: Record<string, string> }) => Promise<{
      session?: BetterAuthSession | null;
      user?: Record<string, unknown> | null;
    } | null>;
    revokeSession: (options: { body: { id: string } }) => Promise<void>;
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

export interface BetterAuthProviderConfig {
  /** better-auth client instance */
  auth: BetterAuthClient;
  /** Map better-auth user to AuthUser */
  mapUser?: (user: Record<string, unknown>) => AuthUser;
  /** Cookie name for session token (default: 'session') */
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

const DEFAULT_COOKIE_NAME = 'session';

/**
 * Wrap better-auth as a Glasswork AuthProvider.
 */
export function createBetterAuthProvider(config: BetterAuthProviderConfig): AuthProvider {
  const { auth, mapUser, cookieName = DEFAULT_COOKIE_NAME } = config;

  const defaultMapUser = (user: Record<string, unknown>): AuthUser => ({
    id: String(user.id ?? user.userId ?? ''),
    email: typeof user.email === 'string' ? user.email : undefined,
    role: (user.role as string) ?? 'user',
    tenantId: (user.tenantId as string | undefined) ?? (user.organizationId as string | undefined),
    ...user,
  });

  return {
    name: 'better-auth',

    async validateSession(token: string) {
      try {
        const result = await auth.api.getSession({
          headers: { cookie: `${cookieName}=${token}` },
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

    async invalidateSession(sessionId: string) {
      await auth.api.revokeSession({ body: { id: sessionId } });
    },

    async refreshSession(sessionId: string) {
      try {
        const result = await auth.api.getSession({
          headers: { cookie: `${cookieName}=${sessionId}` },
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
    metadata: session,
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
