import type { PureAbility } from '@casl/ability';

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

  /**
   * Validate a session token/ID and return session + user.
   */
  validateSession(token: string): Promise<{
    session: TSession;
    user: TUser;
  } | null>;

  /**
   * Invalidate/delete a session.
   */
  invalidateSession(sessionId: string): Promise<void>;

  /**
   * Refresh session (extend expiry, update lastAccessedAt).
   */
  refreshSession?(sessionId: string): Promise<TSession | null>;
}

/**
 * Auth context available in Hono handlers.
 */
export interface AuthContext<
  TUser extends AuthUser = AuthUser,
  TSession extends AuthSession = AuthSession,
  TAbility extends PureAbility = PureAbility,
> {
  user: TUser | null;
  session: TSession | null;
  ability: TAbility;
  isAuthenticated: boolean;
}
