import type { PureAbility } from '@casl/ability';
import { PureAbility as BaseAbility } from '@casl/ability';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { ForbiddenException, UnauthorizedException } from '../http/errors.js';
import type { AuthProvider, AuthSession, AuthUser } from './types.js';

export interface AuthMiddlewareConfig<
  TUser extends AuthUser = AuthUser,
  TAbility extends PureAbility = PureAbility,
  TSession extends AuthSession = AuthSession,
> {
  /** Auth provider instance. */
  provider: AuthProvider<TUser, TSession>;
  /** Function to build ability from user. */
  buildAbility: (user: TUser) => TAbility;
  /** Cookie name for session token (default: 'session'). */
  cookieName?: string;
  /** Header name for token (default: 'Authorization'). */
  headerName?: string;
  /** Whether to allow unauthenticated requests (default: true). */
  allowGuest?: boolean;
  /** Build ability for guest users. */
  guestAbility?: () => TAbility;
  /** Called when a session token is invalid. */
  onInvalidSession?: (c: Context) => void | Promise<void>;
}

type AuthorizeConfig = {
  action: string;
  subject: string | { __caslSubjectType__?: string };
};

/**
 * Create auth middleware that validates sessions and builds abilities.
 */
export function createAuthMiddleware<
  TUser extends AuthUser = AuthUser,
  TAbility extends PureAbility = PureAbility,
  TSession extends AuthSession = AuthSession,
>(config: AuthMiddlewareConfig<TUser, TAbility, TSession>) {
  const {
    provider,
    buildAbility,
    cookieName = 'session',
    headerName = 'Authorization',
    allowGuest = true,
    guestAbility,
    onInvalidSession,
  } = config;

  return function authMiddleware(authorize?: AuthorizeConfig): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const state = await resolveAuthState(c, {
        cookieName,
        headerName,
        provider,
        buildAbility,
        guestAbility,
      });

      applyAuthContext(c, state);

      if (authorize) {
        enforceAuthorization(authorize, state, allowGuest);
      }

      await next();

      if (state.shouldClearCookie) {
        deleteCookie(c, cookieName, { path: '/' });
        await onInvalidSession?.(c);
      }
    };
  };
}

type AuthState<TUser, TAbility, TSession> = {
  user: TUser | null;
  session: TSession | null;
  ability: TAbility;
  isAuthenticated: boolean;
  shouldClearCookie: boolean;
};

async function resolveAuthState<
  TUser extends AuthUser,
  TAbility extends PureAbility,
  TSession extends AuthSession,
>(
  c: Context,
  options: {
    cookieName: string;
    headerName: string;
    provider: AuthProvider<TUser, TSession>;
    buildAbility: (user: TUser) => TAbility;
    guestAbility?: () => TAbility;
  }
): Promise<AuthState<TUser, TAbility, TSession>> {
  const token = getCookie(c, options.cookieName) ?? extractBearerToken(c, options.headerName);
  let user: TUser | null = null;
  let session: TSession | null = null;
  let shouldClearCookie = false;

  if (token) {
    const result = await validateSession(options.provider, token);
    if (result) {
      ({ user, session } = result);
    } else {
      shouldClearCookie = true;
    }
  }

  const ability = user
    ? options.buildAbility(user)
    : (options.guestAbility?.() ?? createEmptyAbility());

  return {
    user,
    session,
    ability,
    isAuthenticated: Boolean(user),
    shouldClearCookie,
  };
}

async function validateSession<TUser extends AuthUser, TSession extends AuthSession>(
  provider: AuthProvider<TUser, TSession>,
  token: string
): Promise<{ user: TUser; session: TSession } | null> {
  try {
    return await provider.validateSession(token);
  } catch {
    return null;
  }
}

function applyAuthContext<
  TUser extends AuthUser,
  TAbility extends PureAbility,
  TSession extends AuthSession,
>(c: Context, state: AuthState<TUser, TAbility, TSession>) {
  c.set('user', state.user);
  c.set('session', state.session);
  c.set('ability', state.ability);
  c.set('isAuthenticated', state.isAuthenticated);
}

function enforceAuthorization<
  TUser extends AuthUser,
  TAbility extends PureAbility,
  TSession extends AuthSession,
>(authorize: AuthorizeConfig, state: AuthState<TUser, TAbility, TSession>, allowGuest: boolean) {
  if (!state.user && !allowGuest) {
    throw new UnauthorizedException('Authentication required');
  }

  if (!state.ability.can(authorize.action, authorize.subject as never)) {
    if (!state.user) {
      throw new UnauthorizedException('Authentication required');
    }

    throw new ForbiddenException(
      `You don't have permission to ${authorize.action} ${authorize.subject}`
    );
  }
}

function extractBearerToken(c: Context, headerName: string): string | null {
  const header = c.req.header(headerName);
  if (!header) return null;

  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  return null;
}

function createEmptyAbility(): PureAbility {
  return new BaseAbility([]);
}
