import type { AnyAbility } from '@casl/ability';

/**
 * Authenticated user context available in handlers.
 */
export interface AuthUser {
  id: string;
  email?: string;
  role: string;
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Session data stored by an auth provider.
 */
export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastAccessedAt?: Date;
  /** Impersonator user ID if the session was created via impersonation */
  impersonatedBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Auth provider interface - implement for custom providers.
 */
export interface AuthProvider<
  TUser extends AuthUser = AuthUser,
  TSession extends AuthSession = AuthSession,
> {
  /** Provider name for logging. */
  readonly name: string;
  /** Provider-specific session cookie name used by auth middleware by default. */
  readonly sessionCookieName?: string;
  /** Resolve runtime cookie settings, including secure prefixes and custom names. */
  getSessionCookieName?(): Promise<string>;

  /**
   * Validate a session token/ID and return session + user.
   */
  validateSession(token: string): Promise<{
    session: TSession;
    user: TUser;
  } | null>;

  /**
   * Invalidate the session identified by its client credential/token.
   */
  invalidateSession(token: string): Promise<void>;

  /**
   * Refresh session (extend expiry, update lastAccessedAt).
   */
  refreshSession?(token: string): Promise<TSession | null>;
}

/**
 * Auth context available in Hono handlers.
 */
export interface AuthContext<
  TUser extends AuthUser = AuthUser,
  TSession extends AuthSession = AuthSession,
  TAbility extends AnyAbility = AnyAbility,
> {
  user: TUser | null;
  session: TSession | null;
  ability: TAbility;
  isAuthenticated: boolean;
}

export type AuthenticatedAuthContext<
  TUser extends AuthUser = AuthUser,
  TSession extends AuthSession = AuthSession,
  TAbility extends AnyAbility = AnyAbility,
> = Omit<AuthContext<TUser, TSession, TAbility>, 'user' | 'session' | 'isAuthenticated'> & {
  user: TUser;
  session: TSession;
  isAuthenticated: true;
};
