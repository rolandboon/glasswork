# Auth & Authorization Development Plan for Glasswork

## Executive Summary

This document outlines a hybrid authentication and authorization solution for Glasswork. Rather than building auth from scratch (security-critical and well-solved by existing libraries), Glasswork provides:

1. **CASL utilities** - First-class authorization with great TypeScript DX
2. **Auth provider adapters** - Pluggable authentication (better-auth, Cognito, custom)
3. **Lambda-optimized session stores** - DynamoDB adapter for serverless
4. **Integrated middleware** - Combines auth + authorization seamlessly

## Background & Context

### Why Not Build Auth From Scratch?

- Authentication is security-critical and complex
- Libraries like better-auth are actively maintained and security-audited
- NestJS also doesn't build auth (uses Passport.js)
- Reinventing auth is a maintenance burden and security risk

### Why Provide Auth Utilities?

- Lambda has specific needs (DynamoDB sessions, cold starts)
- CASL integration benefits from framework-level DX
- Common patterns are repetitive across projects
- Integration with RLS creates a powerful security story

### The Three Layers of Access Control

```
┌─────────────────────────────────────────────────────────────────────┐
│                    1. AUTHENTICATION                                │
│                    "Who are you?"                                   │
│         better-auth / Cognito / custom provider                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    2. AUTHORIZATION (CASL)                          │
│                    "What can you do?"                               │
│         Role-based + attribute-based access control                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    3. DATA FILTERING (RLS)                          │
│                    "What can you see?"                              │
│         PostgreSQL row-level security + CASL accessibleBy           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Authentication** | better-auth built-in, custom providers supported | 95% use case streamlined; still pluggable |
| **Session Store** | DynamoDB adapter included | Lambda-native, serverless |
| **Authorization** | CASL with enhanced DX | Type-safe, Prisma-integrated, proven |
| **Package Structure** | All-in-one `glasswork/auth` | Streamlined DX for common case |
| **Middleware** | Composable factories | Flexible, transparent |

---

## Package Structure

```
glasswork/auth                    # CASL utilities + better-auth integration (default)
  ├── abilities                   # CASL ability builders
  ├── middleware                  # Auth middleware factory
  ├── better-auth/                # better-auth integration (built-in)
  │   ├── provider                # better-auth provider wrapper
  │   └── dynamodb-session        # DynamoDB session adapter
  └── types                       # AuthUser, AuthSession, AuthProvider interface

@glasswork/auth-cognito           # AWS Cognito adapter (future, separate package)
```

**Rationale**: better-auth is the recommended solution for 95% of use cases. Including it directly in `glasswork/auth` provides a streamlined experience. Custom providers (Cognito, etc.) can still implement the `AuthProvider` interface.

---

## Architecture

### Core Auth Module (`glasswork/auth`)

#### Types & Interfaces

```typescript
// types.ts

/**
 * Authenticated user context available in handlers
 */
export interface AuthUser {
  id: string;
  email?: string;
  role: string;
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Session data stored by auth provider
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
 * Auth provider interface - implement for custom providers
 */
export interface AuthProvider {
  /** Provider name for logging */
  readonly name: string;

  /**
   * Validate a session token/ID and return session + user
   */
  validateSession(token: string): Promise<{
    session: AuthSession;
    user: AuthUser;
  } | null>;

  /**
   * Invalidate/delete a session
   */
  invalidateSession(sessionId: string): Promise<void>;

  /**
   * Refresh session (extend expiry, update lastAccessedAt)
   */
  refreshSession?(sessionId: string): Promise<AuthSession>;
}

/**
 * Auth context available in Hono handlers
 */
export interface AuthContext<TUser extends AuthUser = AuthUser> {
  user: TUser | null;
  session: AuthSession | null;
  ability: AppAbility;
  isAuthenticated: boolean;
}
```

#### CASL Ability Builder

```typescript
// abilities.ts
import { AbilityBuilder, PureAbility } from '@casl/ability';
import { createPrismaAbility, PrismaQuery, Subjects } from '@casl/prisma';

/**
 * Create a type-safe ability definition for your application
 *
 * @example
 * ```typescript
 * // Define your subjects (Prisma models)
 * type AppSubjects = Subjects<{
 *   User: User;
 *   Organization: Organization;
 *   Project: Project;
 * }> | 'all';
 *
 * type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';
 *
 * // Create ability factory
 * const defineAbility = createAbilityFactory<AppSubjects, AppAction>();
 *
 * // Define abilities per role
 * const abilities = defineAbility((can, cannot, user) => {
 *   switch (user.role) {
 *     case 'ADMIN':
 *       can('manage', 'all');
 *       break;
 *
 *     case 'MEMBER':
 *       can('read', 'Project', { organizationId: user.organizationId });
 *       can('create', 'Project', { organizationId: user.organizationId });
 *       can('update', 'Project', { createdBy: user.id });
 *       cannot('delete', 'Project');
 *       break;
 *   }
 * });
 * ```
 */
export function createAbilityFactory<
  TSubjects extends string,
  TActions extends string = 'create' | 'read' | 'update' | 'delete' | 'manage',
>() {
  type AppAbility = PureAbility<[TActions, TSubjects], PrismaQuery>;

  return function defineAbility(
    define: (
      can: AbilityBuilder<AppAbility>['can'],
      cannot: AbilityBuilder<AppAbility>['cannot'],
      user: AuthUser
    ) => void
  ) {
    return (user: AuthUser): AppAbility => {
      const { can, cannot, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);
      define(can, cannot, user);
      return build();
    };
  };
}

/**
 * Helper type to extract ability type from factory
 */
export type InferAbility<T> = T extends (user: AuthUser) => infer A ? A : never;
```

#### Role-Based Ability Definition (Alternative API)

```typescript
// abilities-role-based.ts

/**
 * Define abilities using a role-based configuration object
 * More declarative alternative to the function-based approach
 *
 * @example
 * ```typescript
 * const abilities = defineRoleAbilities<AppSubjects, AppAction, AppRoles>({
 *   ADMIN: ({ can }) => {
 *     can('manage', 'all');
 *   },
 *
 *   CUSTOMER_ADMIN: ({ can, user }) => {
 *     can('manage', 'Organization', { id: user.organizationId });
 *     can('manage', 'User', { organizationId: user.organizationId });
 *     can('manage', 'Project', { organizationId: user.organizationId });
 *   },
 *
 *   CUSTOMER_MEMBER: ({ can, cannot, user }) => {
 *     can('read', 'Organization', { id: user.organizationId });
 *     can('read', 'Project', { organizationId: user.organizationId });
 *     can('create', 'Project', { organizationId: user.organizationId });
 *     can('update', 'Project', { createdBy: user.id });
 *     cannot('delete', 'Project');
 *   },
 *
 *   GUEST: () => {
 *     // No abilities
 *   },
 * });
 *
 * // Usage
 * const ability = abilities.for(user);
 * ```
 */
export function defineRoleAbilities<
  TSubjects extends string,
  TActions extends string,
  TRoles extends string,
>(
  config: Record<
    TRoles,
    (ctx: {
      can: AbilityBuilder<PureAbility<[TActions, TSubjects], PrismaQuery>>['can'];
      cannot: AbilityBuilder<PureAbility<[TActions, TSubjects], PrismaQuery>>['cannot'];
      user: AuthUser;
    }) => void
  >
) {
  type AppAbility = PureAbility<[TActions, TSubjects], PrismaQuery>;

  return {
    for(user: AuthUser): AppAbility {
      const { can, cannot, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);
      const roleConfig = config[user.role as TRoles];

      if (roleConfig) {
        roleConfig({ can, cannot, user });
      }

      return build();
    },

    /** Get ability for a specific role (useful for testing) */
    forRole(role: TRoles, user: Partial<AuthUser> = {}): AppAbility {
      return this.for({ id: 'test', role, ...user } as AuthUser);
    },
  };
}
```

#### Authorization Helpers

```typescript
// assert.ts
import { subject as caslSubject } from '@casl/ability';

/**
 * Assert that an action can be performed on a subject
 * Throws ForbiddenException if not allowed
 *
 * @example
 * ```typescript
 * // Check permission on subject type
 * assertCan(ability, 'create', 'Project');
 *
 * // Check permission on specific resource
 * const project = await projectService.findById(id);
 * assertCan(ability, 'update', subject('Project', project));
 *
 * // Custom error message
 * assertCan(ability, 'delete', subject('Project', project), 'Cannot delete this project');
 * ```
 */
export function assertCan<TAbility extends PureAbility>(
  ability: TAbility,
  action: string,
  subject: string | { __caslSubjectType__: string },
  message?: string
): void {
  if (!ability.can(action, subject as any)) {
    throw new ForbiddenException(
      message ?? `You don't have permission to ${action} this resource`
    );
  }
}

/**
 * Check if an action can be performed (without throwing)
 */
export function can<TAbility extends PureAbility>(
  ability: TAbility,
  action: string,
  subject: string | { __caslSubjectType__: string }
): boolean {
  return ability.can(action, subject as any);
}

/**
 * Re-export CASL subject helper
 */
export { caslSubject as subject };
```

#### Auth Middleware Factory

```typescript
// middleware.ts
import type { Context, MiddlewareHandler, Next } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';

export interface AuthMiddlewareConfig<TUser extends AuthUser = AuthUser> {
  /** Auth provider instance */
  provider: AuthProvider;

  /** Function to build ability from user */
  buildAbility: (user: TUser) => PureAbility;

  /** Cookie name for session token (default: 'session') */
  cookieName?: string;

  /** Header name for token (default: 'Authorization') */
  headerName?: string;

  /** Whether to allow unauthenticated requests (default: true) */
  allowGuest?: boolean;

  /** Build ability for guest users */
  guestAbility?: () => PureAbility;

  /** Called when session is invalid */
  onInvalidSession?: (c: Context) => void | Promise<void>;
}

/**
 * Create auth middleware that validates sessions and builds abilities
 *
 * @example
 * ```typescript
 * const authMiddleware = createAuthMiddleware({
 *   provider: betterAuthProvider,
 *   buildAbility: (user) => abilities.for(user),
 *   cookieName: 'session',
 * });
 *
 * // Use in routes
 * app.use('*', authMiddleware());
 *
 * // Or with authorization check
 * router.get('/projects', authMiddleware({ action: 'read', subject: 'Project' }), handler);
 * ```
 */
export function createAuthMiddleware<TUser extends AuthUser = AuthUser>(
  config: AuthMiddlewareConfig<TUser>
) {
  const {
    provider,
    buildAbility,
    cookieName = 'session',
    headerName = 'Authorization',
    allowGuest = true,
    guestAbility,
    onInvalidSession,
  } = config;

  return function authMiddleware(authorize?: {
    action: string;
    subject: string;
  }): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      let user: TUser | null = null;
      let session: AuthSession | null = null;
      let shouldClearCookie = false;

      // Extract token from cookie or header
      const token = getCookie(c, cookieName) ?? extractBearerToken(c, headerName);

      if (token) {
        try {
          const result = await provider.validateSession(token);
          if (result) {
            session = result.session;
            user = result.user as TUser;
          } else {
            shouldClearCookie = true;
          }
        } catch {
          shouldClearCookie = true;
        }
      }

      // Build ability
      const ability = user ? buildAbility(user) : (guestAbility?.() ?? createEmptyAbility());

      // Set auth context
      c.set('user', user);
      c.set('session', session);
      c.set('ability', ability);
      c.set('isAuthenticated', !!user);

      // Check authorization if specified
      if (authorize) {
        if (!user && !allowGuest) {
          throw new UnauthorizedException('Authentication required');
        }

        if (!ability.can(authorize.action, authorize.subject)) {
          if (!user) {
            throw new UnauthorizedException('Authentication required');
          }
          throw new ForbiddenException(
            `You don't have permission to ${authorize.action} ${authorize.subject}`
          );
        }
      }

      await next();

      // Clear invalid session cookie after response
      if (shouldClearCookie) {
        deleteCookie(c, cookieName);
        await onInvalidSession?.(c);
      }
    };
  };
}

function extractBearerToken(c: Context, headerName: string): string | null {
  const header = c.req.header(headerName);
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

function createEmptyAbility(): PureAbility {
  return new PureAbility([]);
}
```

#### Route Helper Integration

```typescript
// route-integration.ts

/**
 * Extended route options with authorization
 */
export interface AuthorizedRouteOptions {
  /** Authorization check - runs after authentication */
  authorize?: {
    action: string;
    subject: string;
  };
}

/**
 * Type augmentation for route helper
 * When using glasswork/auth, routes can specify authorization
 */
declare module 'glasswork' {
  interface RouteOptions extends AuthorizedRouteOptions {}

  interface RouteContext {
    user: AuthUser | null;
    session: AuthSession | null;
    ability: PureAbility;
    isAuthenticated: boolean;
  }
}
```

---

### Better-Auth Integration (Built-in)

The better-auth integration is included directly in `glasswork/auth` for a streamlined experience.

#### DynamoDB Session Store

```typescript
// dynamodb-adapter.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export interface DynamoDBSessionConfig {
  /** DynamoDB table name */
  tableName: string;
  /** AWS region */
  region: string;
  /** Custom endpoint (for LocalStack) */
  endpoint?: string;
  /** Session TTL in seconds (default: 7 days) */
  sessionTTL?: number;
}

/**
 * DynamoDB session adapter for better-auth
 * Optimized for Lambda with lazy client initialization
 *
 * Table schema:
 * - pk (String): Session ID (partition key)
 * - userId (String): User ID (GSI for user lookups)
 * - data (String): JSON session data
 * - expiresAt (Number): TTL timestamp
 */
export function createDynamoDBSessionAdapter(config: DynamoDBSessionConfig) {
  let client: DynamoDBDocumentClient | null = null;
  const sessionTTL = config.sessionTTL ?? 7 * 24 * 60 * 60; // 7 days

  async function getClient(): Promise<DynamoDBDocumentClient> {
    if (!client) {
      const baseClient = new DynamoDBClient({
        region: config.region,
        ...(config.endpoint && { endpoint: config.endpoint }),
      });
      client = DynamoDBDocumentClient.from(baseClient);
    }
    return client;
  }

  return {
    async createSession(session: {
      id: string;
      userId: string;
      expiresAt: Date;
      data?: Record<string, unknown>;
    }) {
      const ddb = await getClient();
      const expiresAtTimestamp = Math.floor(session.expiresAt.getTime() / 1000);

      await ddb.send(new PutCommand({
        TableName: config.tableName,
        Item: {
          pk: session.id,
          userId: session.userId,
          data: JSON.stringify(session.data ?? {}),
          expiresAt: expiresAtTimestamp,
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      }));

      return session;
    },

    async getSession(sessionId: string) {
      const ddb = await getClient();

      const result = await ddb.send(new GetCommand({
        TableName: config.tableName,
        Key: { pk: sessionId },
      }));

      if (!result.Item) {
        return null;
      }

      // Check expiry (DynamoDB TTL is eventually consistent)
      const now = Math.floor(Date.now() / 1000);
      if (result.Item.expiresAt < now) {
        return null;
      }

      return {
        id: result.Item.pk,
        userId: result.Item.userId,
        expiresAt: new Date(result.Item.expiresAt * 1000),
        data: JSON.parse(result.Item.data || '{}'),
        createdAt: new Date(result.Item.createdAt),
        lastAccessedAt: new Date(result.Item.lastAccessedAt),
      };
    },

    async updateSession(sessionId: string, data: Partial<{
      expiresAt: Date;
      data: Record<string, unknown>;
    }>) {
      const ddb = await getClient();

      const updateExpressions: string[] = ['lastAccessedAt = :lastAccessedAt'];
      const expressionValues: Record<string, unknown> = {
        ':lastAccessedAt': new Date().toISOString(),
      };

      if (data.expiresAt) {
        updateExpressions.push('expiresAt = :expiresAt');
        expressionValues[':expiresAt'] = Math.floor(data.expiresAt.getTime() / 1000);
      }

      if (data.data) {
        updateExpressions.push('#data = :data');
        expressionValues[':data'] = JSON.stringify(data.data);
      }

      await ddb.send(new UpdateCommand({
        TableName: config.tableName,
        Key: { pk: sessionId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ...(data.data && { ExpressionAttributeNames: { '#data': 'data' } }),
      }));
    },

    async deleteSession(sessionId: string) {
      const ddb = await getClient();

      await ddb.send(new DeleteCommand({
        TableName: config.tableName,
        Key: { pk: sessionId },
      }));
    },

    async deleteUserSessions(userId: string) {
      // Requires GSI on userId - implementation depends on table design
      // For simplicity, this could be a scan (not recommended for large datasets)
      // Better: use GSI userId-index
    },
  };
}
```

#### Better-Auth Provider Wrapper

```typescript
// better-auth-provider.ts
import type { AuthProvider, AuthUser, AuthSession } from 'glasswork/auth';

export interface BetterAuthProviderConfig {
  /** better-auth client instance */
  auth: ReturnType<typeof betterAuth>;
  /** Map better-auth user to AuthUser */
  mapUser?: (user: any) => AuthUser;
}

/**
 * Wrap better-auth as a Glasswork AuthProvider
 *
 * @example
 * ```typescript
 * import { betterAuth } from 'better-auth';
 * import { createBetterAuthProvider, createDynamoDBSessionAdapter } from 'glasswork/auth';
 *
 * const auth = betterAuth({
 *   database: prisma,
 *   session: {
 *     adapter: createDynamoDBSessionAdapter({
 *       tableName: 'sessions',
 *       region: 'eu-central-1',
 *     }),
 *   },
 *   emailAndPassword: { enabled: true },
 *   socialProviders: {
 *     google: { clientId: '...', clientSecret: '...' },
 *   },
 * });
 *
 * const provider = createBetterAuthProvider({ auth });
 * ```
 */
export function createBetterAuthProvider(
  config: BetterAuthProviderConfig
): AuthProvider {
  const { auth, mapUser } = config;

  const defaultMapUser = (user: any): AuthUser => ({
    id: user.id,
    email: user.email,
    role: user.role ?? 'user',
    tenantId: user.tenantId ?? user.organizationId,
    ...user,
  });

  return {
    name: 'better-auth',

    async validateSession(token: string) {
      try {
        const session = await auth.api.getSession({ headers: { cookie: `session=${token}` } });

        if (!session?.session || !session?.user) {
          return null;
        }

        return {
          session: {
            id: session.session.id,
            userId: session.session.userId,
            expiresAt: new Date(session.session.expiresAt),
            createdAt: new Date(session.session.createdAt),
          },
          user: (mapUser ?? defaultMapUser)(session.user),
        };
      } catch {
        return null;
      }
    },

    async invalidateSession(sessionId: string) {
      await auth.api.revokeSession({ body: { id: sessionId } });
    },

    async refreshSession(sessionId: string) {
      // better-auth handles this automatically
      const session = await auth.api.getSession({ headers: {} });
      return session?.session as AuthSession;
    },
  };
}
```

---

## OpenAPI-Compatible Auth Routes

### The Challenge

better-auth provides its own route handlers, but they don't integrate with Glasswork's OpenAPI generation. To get fully documented auth endpoints, we create **thin route wrappers** around better-auth's core functions.

### Auth Route Factory

```typescript
// glasswork/auth/routes.ts
import * as v from 'valibot';
import type { betterAuth } from 'better-auth';

/**
 * Create OpenAPI-documented auth routes using better-auth
 *
 * @example
 * ```typescript
 * import { createAuthRoutes } from 'glasswork/auth';
 *
 * const authRoutes = createAuthRoutes(auth, {
 *   basePath: '/auth',
 *   // Optional: customize which routes to include
 *   include: ['signUp', 'signIn', 'signOut', 'getSession', 'forgotPassword', 'resetPassword'],
 * });
 *
 * // Mount in your app
 * app.route('/auth', authRoutes);
 * ```
 */
export function createAuthRoutes(
  auth: ReturnType<typeof betterAuth>,
  options?: AuthRoutesOptions
) {
  const router = new Hono();

  // Each route is fully typed with Valibot + OpenAPI
  if (options?.include?.includes('signUp') ?? true) {
    router.post('/sign-up', ...signUpRoute(auth));
  }
  if (options?.include?.includes('signIn') ?? true) {
    router.post('/sign-in', ...signInRoute(auth));
  }
  // ... etc

  return router;
}

interface AuthRoutesOptions {
  basePath?: string;
  include?: Array<'signUp' | 'signIn' | 'signOut' | 'getSession' | 'forgotPassword' | 'resetPassword' | 'oauth'>;
}
```

### Auth Schemas (Valibot)

```typescript
// glasswork/auth/schemas.ts
import * as v from 'valibot';

// ─────────────────────────────────────────────────────────────
// Sign Up
// ─────────────────────────────────────────────────────────────

export const SignUpRequestSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8)),
  name: v.optional(v.string()),
});

export const SignUpResponseSchema = v.object({
  user: v.object({
    id: v.string(),
    email: v.string(),
    name: v.nullable(v.string()),
    createdAt: v.string(),
  }),
  session: v.nullable(v.object({
    id: v.string(),
    expiresAt: v.string(),
  })),
});

// ─────────────────────────────────────────────────────────────
// Sign In
// ─────────────────────────────────────────────────────────────

export const SignInRequestSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.string(),
  rememberMe: v.optional(v.boolean(), false),
});

export const SignInResponseSchema = v.object({
  user: v.object({
    id: v.string(),
    email: v.string(),
    name: v.nullable(v.string()),
    role: v.string(),
  }),
  session: v.object({
    id: v.string(),
    expiresAt: v.string(),
  }),
});

// ─────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────

export const GetSessionResponseSchema = v.object({
  user: v.nullable(v.object({
    id: v.string(),
    email: v.string(),
    name: v.nullable(v.string()),
    role: v.string(),
  })),
  session: v.nullable(v.object({
    id: v.string(),
    expiresAt: v.string(),
  })),
});

// ─────────────────────────────────────────────────────────────
// Password Reset
// ─────────────────────────────────────────────────────────────

export const ForgotPasswordRequestSchema = v.object({
  email: v.pipe(v.string(), v.email()),
});

export const ForgotPasswordResponseSchema = v.object({
  success: v.boolean(),
});

export const ResetPasswordRequestSchema = v.object({
  token: v.string(),
  password: v.pipe(v.string(), v.minLength(8)),
});

export const ResetPasswordResponseSchema = v.object({
  success: v.boolean(),
});

// ─────────────────────────────────────────────────────────────
// OAuth
// ─────────────────────────────────────────────────────────────

export const OAuthStartRequestSchema = v.object({
  provider: v.picklist(['google', 'github', 'microsoft']),
  redirectUrl: v.optional(v.string()),
});

export const OAuthStartResponseSchema = v.object({
  url: v.string(),
});

export const OAuthCallbackRequestSchema = v.object({
  code: v.string(),
  state: v.string(),
});
```

### Route Implementations

```typescript
// glasswork/auth/routes/sign-up.ts
import { route } from 'glasswork';
import { SignUpRequestSchema, SignUpResponseSchema } from '../schemas';

export function signUpRoute(auth: ReturnType<typeof betterAuth>) {
  return route({
    tags: ['Authentication'],
    summary: 'Create a new account',
    body: SignUpRequestSchema,
    responses: {
      201: SignUpResponseSchema,
      400: ErrorResponseSchema,
      409: ErrorResponseSchema, // Email already exists
    },
    handler: async ({ body }) => {
      const result = await auth.api.signUpEmail({
        body: {
          email: body.email,
          password: body.password,
          name: body.name,
        },
      });

      if (!result.user) {
        throw new BadRequestException('Failed to create account');
      }

      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          createdAt: result.user.createdAt.toISOString(),
        },
        session: result.session ? {
          id: result.session.id,
          expiresAt: result.session.expiresAt.toISOString(),
        } : null,
      };
    },
  });
}
```

```typescript
// glasswork/auth/routes/sign-in.ts
import { route } from 'glasswork';
import { setCookie } from 'hono/cookie';
import { SignInRequestSchema, SignInResponseSchema } from '../schemas';

export function signInRoute(auth: ReturnType<typeof betterAuth>) {
  return route({
    tags: ['Authentication'],
    summary: 'Sign in with email and password',
    body: SignInRequestSchema,
    responses: {
      200: SignInResponseSchema,
      401: ErrorResponseSchema,
    },
    handler: async ({ body, c }) => {
      const result = await auth.api.signInEmail({
        body: {
          email: body.email,
          password: body.password,
        },
      });

      if (!result.user || !result.session) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Set session cookie
      setCookie(c, 'session', result.session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: new Date(result.session.expiresAt),
        path: '/',
      });

      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role ?? 'user',
        },
        session: {
          id: result.session.id,
          expiresAt: result.session.expiresAt.toISOString(),
        },
      };
    },
  });
}
```

```typescript
// glasswork/auth/routes/sign-out.ts
import { route } from 'glasswork';
import { deleteCookie } from 'hono/cookie';

export function signOutRoute(auth: ReturnType<typeof betterAuth>) {
  return route({
    tags: ['Authentication'],
    summary: 'Sign out and invalidate session',
    responses: {
      200: v.object({ success: v.boolean() }),
    },
    handler: async ({ c, session }) => {
      if (session) {
        await auth.api.revokeSession({ body: { id: session.id } });
      }

      deleteCookie(c, 'session');

      return { success: true };
    },
  });
}
```

```typescript
// glasswork/auth/routes/oauth.ts
import { route } from 'glasswork';
import { OAuthStartRequestSchema, OAuthStartResponseSchema } from '../schemas';

export function oauthStartRoute(auth: ReturnType<typeof betterAuth>) {
  return route({
    tags: ['Authentication'],
    summary: 'Start OAuth flow',
    body: OAuthStartRequestSchema,
    responses: {
      200: OAuthStartResponseSchema,
    },
    handler: async ({ body }) => {
      const result = await auth.api.signInSocial({
        body: {
          provider: body.provider,
          callbackURL: body.redirectUrl,
        },
      });

      return { url: result.url };
    },
  });
}

export function oauthCallbackRoute(auth: ReturnType<typeof betterAuth>) {
  return route({
    tags: ['Authentication'],
    summary: 'OAuth callback',
    query: OAuthCallbackRequestSchema,
    responses: {
      302: v.null_(), // Redirect
    },
    handler: async ({ query, c }) => {
      const result = await auth.api.signInSocial.callback({
        query: {
          code: query.code,
          state: query.state,
        },
      });

      if (result.session) {
        setCookie(c, 'session', result.session.token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          expires: new Date(result.session.expiresAt),
        });
      }

      // Redirect to app
      return c.redirect(result.redirectURL ?? '/');
    },
  });
}
```

### Handling better-auth Plugins

better-auth has a plugin system that adds routes for 2FA, magic links, passkeys, organizations, etc. These need special consideration.

#### Hybrid Approach (Recommended)

Mount better-auth's handler for plugin routes, use Glasswork routes for core auth:

```typescript
// modules/auth/auth.routes.ts
import { Hono } from 'hono';
import { createAuthRoutes } from 'glasswork/auth';
import { auth } from './auth.setup';

const router = new Hono();

// ─────────────────────────────────────────────────────────────
// Core auth routes - OpenAPI documented
// ─────────────────────────────────────────────────────────────
const coreRoutes = createAuthRoutes(auth, {
  include: ['signUp', 'signIn', 'signOut', 'getSession', 'forgotPassword', 'resetPassword'],
});
router.route('/', coreRoutes);

// ─────────────────────────────────────────────────────────────
// Plugin routes - mounted directly from better-auth
// (2FA, magic links, passkeys, etc.)
// Note: These won't appear in OpenAPI spec
// ─────────────────────────────────────────────────────────────
router.all('/two-factor/*', (c) => auth.handler(c.req.raw));
router.all('/magic-link/*', (c) => auth.handler(c.req.raw));
router.all('/passkey/*', (c) => auth.handler(c.req.raw));

// Or mount ALL better-auth routes (including core)
// and only use Glasswork routes for customization:
// router.all('/*', (c) => auth.handler(c.req.raw));

export { router as authRoutes };
```

#### Plugin Route Wrappers (For Popular Plugins)

For commonly used plugins, Glasswork can provide OpenAPI-documented wrappers:

```typescript
// glasswork/auth/plugins/two-factor.ts
import * as v from 'valibot';

export const TwoFactorSetupResponseSchema = v.object({
  totpURI: v.string(),
  secret: v.string(),
  qrCode: v.string(),
});

export const TwoFactorVerifyRequestSchema = v.object({
  code: v.pipe(v.string(), v.length(6)),
});

export function createTwoFactorRoutes(auth: ReturnType<typeof betterAuth>) {
  const router = new Hono();

  // Setup 2FA - get QR code
  router.post('/setup', ...route({
    tags: ['Two-Factor Authentication'],
    summary: 'Enable 2FA and get setup QR code',
    responses: { 200: TwoFactorSetupResponseSchema },
    handler: async ({ session }) => {
      if (!session) throw new UnauthorizedException();
      const result = await auth.api.twoFactor.enable({ ... });
      return result;
    },
  }));

  // Verify 2FA code
  router.post('/verify', ...route({
    tags: ['Two-Factor Authentication'],
    summary: 'Verify 2FA code',
    body: TwoFactorVerifyRequestSchema,
    responses: { 200: v.object({ success: v.boolean() }) },
    handler: async ({ body, session }) => {
      const result = await auth.api.twoFactor.verify({ body });
      return result;
    },
  }));

  return router;
}
```

```typescript
// Usage
import { createAuthRoutes, createTwoFactorRoutes } from 'glasswork/auth';

router.route('/', createAuthRoutes(auth));
router.route('/two-factor', createTwoFactorRoutes(auth));
```

#### Supported Plugin Wrappers (Phase 2+)

| Plugin | Glasswork Wrapper | Status |
|--------|-------------------|--------|
| Two-Factor (TOTP) | `createTwoFactorRoutes()` | Phase 2 |
| Magic Link | `createMagicLinkRoutes()` | Phase 2 |
| Passkey/WebAuthn | `createPasskeyRoutes()` | Phase 3 |
| Organizations | `createOrganizationRoutes()` | Phase 3 |
| API Keys | `createApiKeyRoutes()` | Future |

#### Fallback: Mount All better-auth Routes

If you don't need OpenAPI for auth routes, simply mount better-auth directly:

```typescript
// Mount better-auth handler for all auth routes
// Simple, but no OpenAPI documentation
app.all('/auth/*', (c) => auth.handler(c.req.raw));
```

#### Trade-offs

| Approach | OpenAPI | Plugins | Effort |
|----------|---------|---------|--------|
| Glasswork routes only | ✅ Full | ❌ Manual wrappers needed | High |
| Hybrid (recommended) | ✅ Core | ✅ Plugin routes mounted | Medium |
| better-auth handler only | ❌ None | ✅ Full | Low |

**Recommendation**: Use hybrid approach. Document core auth routes with OpenAPI, mount plugin routes directly. Add Glasswork wrappers for commonly used plugins over time.

---

### Usage in Application

```typescript
// modules/auth/auth.routes.ts
import { createRoutes } from 'glasswork';
import { createAuthRoutes, createTwoFactorRoutes } from 'glasswork/auth';
import { auth } from './auth.setup';

// Option 1: Use the pre-built routes + plugins
const authRoutes = new Hono();
authRoutes.route('/', createAuthRoutes(auth));
authRoutes.route('/two-factor', createTwoFactorRoutes(auth));
// Mount remaining plugins directly
authRoutes.all('/passkey/*', (c) => auth.handler(c.req.raw));

export { authRoutes };

// Option 2: Customize individual routes
export const customAuthRoutes = createRoutes((router, services, route) => {
  // Use built-in sign-in but customize sign-up
  router.post('/sign-in', ...signInRoute(auth));

  // Custom sign-up with additional fields
  router.post('/sign-up', ...route({
    tags: ['Authentication'],
    summary: 'Create account with organization',
    body: v.object({
      email: v.pipe(v.string(), v.email()),
      password: v.pipe(v.string(), v.minLength(8)),
      name: v.string(),
      organizationName: v.string(), // Custom field
    }),
    responses: {
      201: SignUpResponseSchema,
    },
    handler: async ({ body }) => {
      // Create organization first
      const org = await services.organizationService.create({
        name: body.organizationName,
      });

      // Then create user with better-auth
      const result = await auth.api.signUpEmail({
        body: {
          email: body.email,
          password: body.password,
          name: body.name,
          organizationId: org.id, // Custom field
          role: 'CUSTOMER_ADMIN',
        },
      });

      return { user: result.user, session: result.session };
    },
  }));
});
```

### Generated OpenAPI

The routes will generate proper OpenAPI documentation:

```yaml
paths:
  /auth/sign-up:
    post:
      tags: [Authentication]
      summary: Create a new account
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  minLength: 8
                name:
                  type: string
      responses:
        '201':
          description: Account created
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    type: object
                    properties:
                      id: { type: string }
                      email: { type: string }
                      name: { type: string, nullable: true }
                  session:
                    type: object
                    nullable: true
                    properties:
                      id: { type: string }
                      expiresAt: { type: string }
        '400':
          $ref: '#/components/schemas/ErrorResponse'
        '409':
          $ref: '#/components/schemas/ErrorResponse'

  /auth/sign-in:
    post:
      tags: [Authentication]
      summary: Sign in with email and password
      # ... full OpenAPI spec
```

---

## Full Integration Example

```typescript
// modules/auth/abilities.ts
import { defineRoleAbilities, type AuthUser } from 'glasswork/auth';
import type { Subjects } from '@casl/prisma';
import type { User, Organization, Project, Order } from '@prisma/client';

type AppSubjects = Subjects<{
  User: User;
  Organization: Organization;
  Project: Project;
  Order: Order;
}> | 'all';

type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';
type AppRole = 'ADMIN' | 'CUSTOMER_ADMIN' | 'CUSTOMER_MEMBER' | 'GUEST';

export const abilities = defineRoleAbilities<AppSubjects, AppAction, AppRole>({
  ADMIN: ({ can }) => {
    can('manage', 'all');
  },

  CUSTOMER_ADMIN: ({ can, user }) => {
    can('manage', 'Organization', { id: user.tenantId });
    can('manage', 'User', { organizationId: user.tenantId });
    can('manage', 'Project', { organizationId: user.tenantId });
    can('manage', 'Order', { organizationId: user.tenantId });
  },

  CUSTOMER_MEMBER: ({ can, cannot, user }) => {
    can('read', 'Organization', { id: user.tenantId });
    can('read', 'Project', { organizationId: user.tenantId });
    can('create', 'Project', { organizationId: user.tenantId, createdBy: user.id });
    can('update', 'Project', { organizationId: user.tenantId, createdBy: user.id });
    cannot('delete', 'Project');
    can('read', 'Order', { organizationId: user.tenantId });
    can('create', 'Order', { organizationId: user.tenantId });
  },

  GUEST: () => {
    // No abilities
  },
});

export type AppAbility = ReturnType<typeof abilities.for>;
```

```typescript
// modules/auth/auth.setup.ts
import { betterAuth } from 'better-auth';
import {
  createAuthMiddleware,
  createBetterAuthProvider,
  createDynamoDBSessionAdapter,
} from 'glasswork/auth';
import { abilities } from './abilities';

// Configure better-auth
export const auth = betterAuth({
  database: prisma,
  session: {
    adapter: createDynamoDBSessionAdapter({
      tableName: process.env.SESSION_TABLE!,
      region: process.env.AWS_REGION!,
    }),
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'CUSTOMER_MEMBER' },
      organizationId: { type: 'string', optional: true },
    },
  },
});

// Create Glasswork auth provider
const provider = createBetterAuthProvider({ auth });

// Create auth middleware
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
  cookieName: 'session',
  guestAbility: () => abilities.forRole('GUEST'),
});
```

```typescript
// routes/project.routes.ts
import { createRoutes } from 'glasswork';
import { authMiddleware } from '../auth/auth.setup';
import { assertCan, subject } from 'glasswork/auth';
import { accessibleBy } from '@casl/prisma';

export const projectRoutes = createRoutes((router, { projectService }, route) => {
  // Apply auth middleware to all routes
  router.use('*', authMiddleware());

  // List projects - uses CASL to filter
  router.get('/', ...route({
    authorize: { action: 'read', subject: 'Project' },
    responses: { 200: ProjectListDto },
    handler: async ({ ability }) => {
      // CASL filters to only projects user can access
      return projectService.findAll(ability);
    },
  }));

  // Get single project
  router.get('/:id', ...route({
    params: v.object({ id: v.string() }),
    responses: { 200: ProjectDto },
    handler: async ({ params, ability }) => {
      const project = await projectService.findById(params.id);
      if (!project) throw new NotFoundException('Project not found');

      // Check permission on specific resource
      assertCan(ability, 'read', subject('Project', project));

      return project;
    },
  }));

  // Create project
  router.post('/', ...route({
    authorize: { action: 'create', subject: 'Project' },
    body: CreateProjectDto,
    responses: { 201: ProjectDto },
    handler: async ({ body, user, ability }) => {
      // Validate user can create for this organization
      assertCan(ability, 'create', subject('Project', {
        organizationId: body.organizationId,
        createdBy: user!.id,
      }));

      return projectService.create(body, user!.id);
    },
  }));

  // Update project
  router.patch('/:id', ...route({
    params: v.object({ id: v.string() }),
    body: UpdateProjectDto,
    responses: { 200: ProjectDto },
    handler: async ({ params, body, ability }) => {
      const project = await projectService.findById(params.id);
      if (!project) throw new NotFoundException('Project not found');

      assertCan(ability, 'update', subject('Project', project));

      return projectService.update(params.id, body);
    },
  }));

  // Delete project
  router.delete('/:id', ...route({
    params: v.object({ id: v.string() }),
    responses: { 204: v.null_() },
    handler: async ({ params, ability }) => {
      const project = await projectService.findById(params.id);
      if (!project) throw new NotFoundException('Project not found');

      assertCan(ability, 'delete', subject('Project', project));

      await projectService.delete(params.id);
      return null;
    },
  }));
});
```

```typescript
// services/project.service.ts
import { accessibleBy } from '@casl/prisma';
import type { AppAbility } from '../auth/abilities';

export class ProjectService {
  constructor(private prisma: PrismaClient) {}

  async findAll(ability: AppAbility): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: accessibleBy(ability).Project,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async create(data: CreateProjectDto, createdBy: string): Promise<Project> {
    return this.prisma.project.create({
      data: {
        ...data,
        createdBy,
      },
    });
  }

  async update(id: string, data: UpdateProjectDto): Promise<Project> {
    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
```

---

## Integration with RLS Module

When using both CASL and RLS:

```typescript
// Combine CASL (application-level) with RLS (database-level)
// CASL: Fine-grained permission checks, complex business rules
// RLS: Tenant isolation, defense-in-depth

export class ProjectService {
  constructor(
    // RLS-scoped Prisma client (from rls module)
    private tenantPrisma: PrismaClient,
  ) {}

  async findAll(ability: AppAbility): Promise<Project[]> {
    // RLS ensures tenant isolation at DB level
    // CASL adds additional filtering (e.g., role-based visibility)
    return this.tenantPrisma.project.findMany({
      where: accessibleBy(ability).Project,
    });
  }
}
```

---

## Testing

### Testing Abilities

```typescript
import { abilities } from './abilities';

describe('abilities', () => {
  describe('ADMIN', () => {
    const ability = abilities.forRole('ADMIN');

    it('can manage all resources', () => {
      expect(ability.can('manage', 'all')).toBe(true);
      expect(ability.can('delete', 'Project')).toBe(true);
    });
  });

  describe('CUSTOMER_MEMBER', () => {
    const ability = abilities.forRole('CUSTOMER_MEMBER', {
      id: 'user-1',
      tenantId: 'org-1',
    });

    it('can read projects in their organization', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-1',
      }))).toBe(true);
    });

    it('cannot read projects in other organizations', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-2',
      }))).toBe(false);
    });

    it('can only update projects they created', () => {
      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-1',
      }))).toBe(true);

      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-2',
      }))).toBe(false);
    });

    it('cannot delete any project', () => {
      expect(ability.can('delete', 'Project')).toBe(false);
    });
  });
});
```

### Testing Middleware

```typescript
import { createAuthMiddleware } from 'glasswork/auth';
import { Hono } from 'hono';

describe('authMiddleware', () => {
  const mockProvider = {
    name: 'mock',
    validateSession: vi.fn(),
    invalidateSession: vi.fn(),
  };

  const middleware = createAuthMiddleware({
    provider: mockProvider,
    buildAbility: (user) => abilities.for(user),
  });

  it('sets guest context when no session', async () => {
    mockProvider.validateSession.mockResolvedValue(null);

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({
      isAuthenticated: c.get('isAuthenticated'),
      user: c.get('user'),
    }));

    const res = await app.request('/test');
    const body = await res.json();

    expect(body.isAuthenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  it('sets user context when session valid', async () => {
    mockProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1' },
      user: { id: 'user-1', role: 'ADMIN' },
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({
      isAuthenticated: c.get('isAuthenticated'),
      user: c.get('user'),
    }));

    const res = await app.request('/test', {
      headers: { Cookie: 'session=valid-token' },
    });
    const body = await res.json();

    expect(body.isAuthenticated).toBe(true);
    expect(body.user.id).toBe('user-1');
  });

  it('throws 401 when authorization required but not authenticated', async () => {
    mockProvider.validateSession.mockResolvedValue(null);

    const app = new Hono();
    app.use('*', middleware({ action: 'read', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');

    expect(res.status).toBe(401);
  });

  it('throws 403 when authorization required but not permitted', async () => {
    mockProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1' },
      user: { id: 'user-1', role: 'GUEST' },
    });

    const app = new Hono();
    app.use('*', middleware({ action: 'delete', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Cookie: 'session=valid-token' },
    });

    expect(res.status).toBe(403);
  });
});
```

---

## Dependencies

### `glasswork/auth`

```json
{
  "dependencies": {
    "@casl/ability": "^6.0.0",
    "@casl/prisma": "^1.0.0"
  },
  "peerDependencies": {
    "better-auth": "^1.0.0",
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "better-auth": {
      "optional": true
    },
    "@aws-sdk/client-dynamodb": {
      "optional": true
    },
    "@aws-sdk/lib-dynamodb": {
      "optional": true
    }
  }
}
```

**Note**: The AWS SDK and better-auth are optional peer dependencies. They're only required if you use the DynamoDB session adapter and better-auth provider. For custom providers, only CASL dependencies are needed.

---

## Implementation Phases

### Phase 1: Core CASL Utilities
**Goal**: Type-safe ability building and helpers

**Deliverables**:
1. `createAbilityFactory()` function
2. `defineRoleAbilities()` alternative API
3. `assertCan()` and `can()` helpers
4. `subject()` re-export
5. Type definitions for `AuthUser`, `AuthSession`, `AuthProvider`
6. Unit tests
7. Documentation and examples

### Phase 2: Auth Middleware + Better-Auth
**Goal**: Flexible auth middleware with better-auth integration

**Deliverables**:
1. `AuthProvider` interface for custom providers
2. `createAuthMiddleware()` factory
3. Cookie and Bearer token support
4. Guest ability support
5. `createBetterAuthProvider()` wrapper
6. `createDynamoDBSessionAdapter()` for sessions
7. Route helper integration (`authorize` option)
8. Hono context type augmentation
9. SAM template snippet for sessions table
10. **`createAuthRoutes()`** - OpenAPI-documented auth routes
11. **Valibot schemas** for all auth endpoints
12. **Route factories** - `signUpRoute()`, `signInRoute()`, etc.

### Phase 3: Testing Utilities
**Goal**: Easy testing of auth flows

**Deliverables**:
1. Mock auth provider for tests
2. Ability testing helpers
3. Route testing with auth context
4. Documentation for testing patterns

### Phase 4: RLS Integration
**Goal**: Combine CASL with RLS

**Deliverables**:
1. Integration guide for CASL + RLS
2. Best practices documentation
3. Example combining both layers

---

## Success Criteria

A successful auth module for Glasswork will:

1. ✅ Provide type-safe CASL ability building with great DX
2. ✅ Include better-auth integration out of the box
3. ✅ Include Lambda-optimized DynamoDB session store
4. ✅ Support custom auth providers via `AuthProvider` interface
5. ✅ Offer flexible middleware with authorization checks
6. ✅ Integrate seamlessly with route helpers (`authorize` option)
7. ✅ Work well with RLS module for defense-in-depth
8. ✅ Have comprehensive testing utilities
9. ✅ Follow Glasswork's transparency principle
10. ✅ Not reinvent authentication (wrap better-auth)
11. ✅ Be a single import for 95% of use cases
12. ✅ Have clear documentation and examples

---

## Next Steps

1. **Phase 1**: Build core CASL utilities
2. **Validate**: Test ability patterns with existing application code
3. **Phase 2**: Build auth middleware + better-auth integration
4. **Phase 3**: Add testing utilities
5. **Document**: Write comprehensive guides

