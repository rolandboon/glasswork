# Authentication & Authorization

Glasswork ships a lightweight auth module focused on authorization (CASL), pluggable authentication providers, and middleware that wires request context for routes and OpenAPI.

## What's included
- `createAbilityFactory` / `defineRoleAbilities` for CASL abilities (Prisma-ready).
- `assertCan`, `can`, `subject` helpers for concise checks.
- `createAuthMiddleware` to validate sessions, set `user`, `session`, `ability`, `isAuthenticated`, and optionally enforce authorization.
- `createBetterAuthProvider` to wrap a `better-auth` instance.
- `createDynamoDBSessionAdapter` for serverless-friendly session storage.

## Quick start
```ts
import {
  createAbilityFactory,
  createAuthMiddleware,
  createBetterAuthProvider,
  createDynamoDBSessionAdapter,
} from 'glasswork';

// 1) Define abilities
type Subjects = 'Project' | 'Organization' | 'all';
const defineAbility = createAbilityFactory<Subjects>()((can, _cannot, user) => {
  if (user.role === 'ADMIN') can('manage', 'all');
  else can('read', 'Project', { organizationId: user.tenantId });
});

// 2) Wire provider (better-auth shown here)
const provider = createBetterAuthProvider({
  auth, // better-auth client instance
  mapUser: (user) => ({ id: user.id as string, role: (user.role as string) ?? 'USER' }),
});

// 3) Middleware
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => defineAbility(user),
  guestAbility: () => defineAbility({ id: 'guest', role: 'GUEST' }),
});
```

## Route-level authorization
Add `authorize` to a route to enforce permissions before the handler runs.
```ts
router.get(
  '/projects',
  ...route(router, {
    authorize: { action: 'read', subject: 'Project' },
    responses: { 200: ProjectListSchema },
    handler: async ({ ability }) => projectService.findAll(ability),
  })
);
```
Behavior:
- If `authorize` is set, `ability.can(action, subject)` must succeed.
- When `allowGuest` is false and no user is set, a 401 is thrown.
- Otherwise a failed check returns 403.

## better-auth + DynamoDB sessions
```ts
import { betterAuth } from 'better-auth';
import { createBetterAuthProvider, createDynamoDBSessionAdapter } from 'glasswork';

const auth = betterAuth({
  session: {
    adapter: createDynamoDBSessionAdapter({
      tableName: process.env.SESSION_TABLE!,
      region: process.env.AWS_REGION!,
    }),
  },
  emailAndPassword: { enabled: true },
});

const provider = createBetterAuthProvider({ auth });
```
Notes:
- DynamoDB adapter lazy-loads AWS SDK; ensure `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` are installed.
- The adapter checks TTL and will return `null` for expired sessions even before DynamoDB TTL cleanup.

## Context typing
Auth middleware sets Hono context values, which flow into `RouteContext`:
- `user: AuthUser | null`
- `session: AuthSession | null`
- `ability: PureAbility`
- `isAuthenticated: boolean`

These are available inside route handlers and can be used directly without casting.

## Testing helpers
- Use `defineRoleAbilities(...).forRole(role)` to build abilities in tests.
- Middleware is easy to test with Hono’s `app.request()`; invalid sessions automatically clear the cookie and return 401/403 based on `authorize`.
- The DynamoDB adapter accepts an injected `documentClient` for unit tests (see `test/auth/dynamodb-session-adapter.spec.ts`).

## Error handling
- Missing auth when required → `UnauthorizedException` (401).
- Forbidden action with a user → `ForbiddenException` (403).
- Invalid session token → cookie cleared after the response and `onInvalidSession` callback invoked if provided.
