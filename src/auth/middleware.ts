import { Ability, type AnyAbility } from '@casl/ability';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { ForbiddenException, UnauthorizedException } from '../http/errors.js';
import { setRequestAuth } from '../observability/request-context.js';
import { AuthenticationUnavailableException, InvalidSessionError } from './errors.js';
import type { AuthContext, AuthProvider, AuthSession, AuthUser } from './types.js';

export interface AuthMiddlewareConfig<
  TUser extends AuthUser = AuthUser,
  TAbility extends AnyAbility = AnyAbility,
  TSession extends AuthSession = AuthSession,
> {
  /** Auth provider instance. */
  provider: AuthProvider<TUser, TSession>;
  /** Function to build ability from user. */
  buildAbility: (user: TUser) => TAbility;
  /** Cookie name for session token (default: provider setting or 'session'). */
  cookieName?: string;
  /** Header name for token (default: 'Authorization'). */
  headerName?: string;
  /** Whether to allow unauthenticated requests (default: true). */
  allowGuest?: boolean;
  /** Build ability for guest users. */
  guestAbility?: () => TAbility;
  /** Called when a session token is invalid. */
  onInvalidSession?: (c: Context) => void | Promise<void>;
  /** Messages and stable codes of the errors this middleware throws. */
  errors?: AuthErrorOptions;
}

/** Message and stable client code of an auth error response. */
export interface AuthErrorResponse {
  message?: string;
  code?: string;
}

export interface AuthErrorOptions {
  /** 401 when a request needs a session and has none (default code `auth-required`). */
  authenticationRequired?: AuthErrorResponse;
  /** 403 when the ability denies `authorize` (default code `forbidden`). */
  forbidden?: AuthErrorResponse;
}

export type AuthAuthorizeConfig<TAbility extends AnyAbility = AnyAbility> = {
  action: Parameters<TAbility['can']>[0];
  subject: Parameters<TAbility['can']>[1];
};

type AuthEnvironment<
  TUser extends AuthUser,
  TAbility extends AnyAbility,
  TSession extends AuthSession,
> = {
  Variables: AuthContext<TUser, TSession, TAbility>;
};

export type AuthMiddleware<
  TUser extends AuthUser = AuthUser,
  TAbility extends AnyAbility = AnyAbility,
  TSession extends AuthSession = AuthSession,
> = (
  authorize?: AuthAuthorizeConfig<TAbility>
) => MiddlewareHandler<AuthEnvironment<TUser, TAbility, TSession>>;

/**
 * Create auth middleware that validates sessions and builds abilities.
 */
export function createAuthMiddleware<
  TUser extends AuthUser = AuthUser,
  TAbility extends AnyAbility = AnyAbility,
  TSession extends AuthSession = AuthSession,
>(
  config: AuthMiddlewareConfig<TUser, TAbility, TSession>
): AuthMiddleware<TUser, TAbility, TSession> {
  const {
    provider,
    buildAbility,
    cookieName: configuredCookieName,
    headerName = 'Authorization',
    allowGuest = true,
    guestAbility,
    onInvalidSession,
    errors = {},
  } = config;

  return function authMiddleware(
    authorize?: AuthAuthorizeConfig<TAbility>
  ): MiddlewareHandler<AuthEnvironment<TUser, TAbility, TSession>> {
    return async (c: Context<AuthEnvironment<TUser, TAbility, TSession>>, next: Next) => {
      const cookieName =
        configuredCookieName ??
        (await provider.getSessionCookieName?.()) ??
        provider.sessionCookieName ??
        'session';
      const state = await resolveAuthState(c, {
        cookieName,
        headerName,
        provider,
        buildAbility,
        guestAbility,
      });

      applyAuthContext(c, state);

      if (!state.isAuthenticated && !allowGuest) {
        await clearInvalidSession(c, state.shouldClearCookie, cookieName, onInvalidSession);
        throw authenticationRequired(errors);
      }

      if (authorize) {
        enforceAuthorization(authorize, state, errors);
      }

      await next();

      await clearInvalidSession(c, state.shouldClearCookie, cookieName, onInvalidSession);
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
  TAbility extends AnyAbility,
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
    : ((options.guestAbility?.() ?? createEmptyAbility()) as TAbility);

  return {
    user,
    session,
    ability,
    isAuthenticated: Boolean(user),
    shouldClearCookie,
  };
}

/**
 * null and InvalidSessionError mean the token is not a valid session. Any other error means
 * the provider could not tell, so the request fails without treating the user as logged out.
 */
async function validateSession<TUser extends AuthUser, TSession extends AuthSession>(
  provider: AuthProvider<TUser, TSession>,
  token: string
): Promise<{ user: TUser; session: TSession } | null> {
  try {
    return await provider.validateSession(token);
  } catch (error) {
    if (error instanceof InvalidSessionError) return null;
    throw new AuthenticationUnavailableException(error);
  }
}

function applyAuthContext<
  TUser extends AuthUser,
  TAbility extends AnyAbility,
  TSession extends AuthSession,
>(
  c: Context<AuthEnvironment<TUser, TAbility, TSession>>,
  state: AuthState<TUser, TAbility, TSession>
) {
  c.set('user', state.user);
  c.set('session', state.session);
  c.set('ability', state.ability);
  c.set('isAuthenticated', state.isAuthenticated);

  if (state.user?.id) {
    setRequestAuth({
      userId: state.user.id,
      tenantId: state.user.tenantId,
      impersonatedBy: state.session?.impersonatedBy,
    });
  }
}

function enforceAuthorization<
  TUser extends AuthUser,
  TAbility extends AnyAbility,
  TSession extends AuthSession,
>(
  authorize: AuthAuthorizeConfig<TAbility>,
  state: AuthState<TUser, TAbility, TSession>,
  errors: AuthErrorOptions
) {
  if (!state.ability.can(authorize.action, authorize.subject as never)) {
    if (!state.isAuthenticated) {
      throw authenticationRequired(errors);
    }

    throw new ForbiddenException(
      errors.forbidden?.message ??
        `You don't have permission to ${authorize.action} ${authorize.subject}`,
      { errorCode: errors.forbidden?.code ?? 'forbidden' }
    );
  }
}

function authenticationRequired(errors: AuthErrorOptions): UnauthorizedException {
  return new UnauthorizedException(
    errors.authenticationRequired?.message ?? 'Authentication required',
    { errorCode: errors.authenticationRequired?.code ?? 'auth-required' }
  );
}

async function clearInvalidSession(
  c: Context,
  shouldClearCookie: boolean,
  cookieName: string,
  onInvalidSession?: (c: Context) => void | Promise<void>
): Promise<void> {
  if (!shouldClearCookie) return;

  // __Secure- and __Host- prefixed cookies may only be set (and cleared) with the Secure attribute
  const secure = cookieName.startsWith('__Secure-') || cookieName.startsWith('__Host-');
  deleteCookie(c, cookieName, { path: '/', ...(secure ? { secure: true } : {}) });
  await onInvalidSession?.(c);
}

function extractBearerToken(c: Context, headerName: string): string | null {
  const header = c.req.header(headerName);
  if (!header) return null;

  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  return null;
}

function createEmptyAbility(): AnyAbility {
  return new Ability([]);
}
