# Auth Middleware

The auth middleware validates sessions, builds CASL abilities, and optionally enforces authorization on routes.

## Configuration

Create auth middleware using `createAuthMiddleware()`:

```typescript
import { createAuthMiddleware, createBetterAuthProvider } from 'glasswork';
import { auth } from './auth.config';
import { abilities } from './abilities';

const provider = createBetterAuthProvider({
  auth,
  mapUser: (user) => ({
    id: user.id as string,
    email: user.email as string,
    role: (user.role as string) ?? 'member',
    tenantId: user.organizationId as string | undefined,
  }),
});

export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `AuthProvider` | Required | Auth provider (e.g., Better Auth wrapper) |
| `buildAbility` | `(user) => Ability` | Required | Function to build CASL ability from user |
| `cookieName` | `string` | `'session'` | Cookie name for session token |
| `headerName` | `string` | `'Authorization'` | Header name for Bearer token |
| `allowGuest` | `boolean` | `true` | Allow unauthenticated requests |
| `guestAbility` | `() => Ability` | Empty ability | Ability for guest users |
| `onInvalidSession` | `(c) => void` | - | Callback when session is invalid |

## Usage

### Apply to All Routes

```typescript
import { authMiddleware } from './auth/auth.middleware';

// Add to all routes in a router
router.use('*', authMiddleware());

// Or to all API routes
app.use('/api/*', authMiddleware());
```

### Route-Level Authorization

Pass an `authorize` object to require specific permissions:

```typescript
router.get('/projects', 
  authMiddleware({ action: 'read', subject: 'Project' }),
  handler
);
```

Or use the `authorize` option in the `route()` helper:

```typescript
router.get('/projects', ...route({
  authorize: { action: 'read', subject: 'Project' },
  responses: { 200: ProjectListSchema },
  handler: async ({ ability }) => {
    return projectService.findAll(ability);
  },
}));
```

## Session Resolution

The middleware extracts session tokens in this order:

1. **Cookie** - Looks for `cookieName` (default: `session`)
2. **Bearer Token** - Parses `Authorization: Bearer <token>` header

If a token is found, it's validated via the provider. Invalid sessions automatically clear the cookie after the response.

## Guest Access

By default, unauthenticated requests are allowed with an empty ability. Configure guest behavior:

```typescript
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
  
  // Allow guests (default: true)
  allowGuest: true,
  
  // Define what guests can do
  guestAbility: () => abilities.forRole('guest'),
});
```

### Requiring Authentication

To require authentication, either:

**Option 1**: Set `allowGuest: false` globally:

```typescript
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
  allowGuest: false, // 401 for unauthenticated requests
});
```

**Option 2**: Use `authorize` on specific routes - unauthenticated users get 401:

```typescript
router.get('/profile', ...route({
  authorize: { action: 'read', subject: 'User' },
  // 401 if not authenticated, 403 if authenticated but no permission
}));
```

## Error Handling

| Scenario | Response |
|----------|----------|
| No token, `allowGuest: true` | Continues with `user: null` |
| No token, `allowGuest: false` | 401 Unauthorized |
| Invalid token | Cookie cleared, continues with `user: null` |
| Authorization fails, not authenticated | 401 Unauthorized |
| Authorization fails, authenticated | 403 Forbidden |

### Custom Error Messages

Errors use Glasswork's standard exceptions:

```typescript
// From middleware - can be caught in error handler
import { UnauthorizedException, ForbiddenException } from 'glasswork';

// In handler - for custom checks
handler: async ({ ability }) => {
  if (!ability.can('delete', 'Project')) {
    throw new ForbiddenException('Only admins can delete projects');
  }
}
```

## Context Values

The middleware sets these values on the Hono context:

```typescript
// Available in handlers
handler: async ({ user, session, ability, isAuthenticated, c }) => {
  // TypeScript-aware access
  console.log(user?.id);        // AuthUser | null
  console.log(session?.id);     // AuthSession | null
  console.log(isAuthenticated); // boolean
  
  // Use ability for checks
  if (ability.can('manage', 'all')) {
    // Admin access
  }
  
  // Direct context access (same values)
  c.get('user');
  c.get('ability');
}
```

### Type Definitions

```typescript
interface AuthUser {
  id: string;
  email?: string;
  role: string;
  tenantId?: string;
  [key: string]: unknown;
}

interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastAccessedAt?: Date;
  metadata?: Record<string, unknown>;
}
```

## Invalid Session Handling

When a session token is invalid or expired:

1. The response proceeds (user is set to `null`)
2. After the response, the session cookie is deleted
3. Optional `onInvalidSession` callback is invoked

```typescript
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
  onInvalidSession: async (c) => {
    // Log, track metrics, etc.
    console.log('Invalid session cleared');
  },
});
```

## Custom Auth Providers

For auth systems other than Better Auth, implement the `AuthProvider` interface:

```typescript
import type { AuthProvider, AuthUser, AuthSession } from 'glasswork';

const customProvider: AuthProvider = {
  name: 'custom',

  async validateSession(token: string) {
    // Validate token with your auth system
    const session = await myAuthSystem.validate(token);
    
    if (!session) return null;
    
    return {
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      },
    };
  },

  async invalidateSession(sessionId: string) {
    await myAuthSystem.revoke(sessionId);
  },

  async refreshSession(sessionId: string) {
    return myAuthSystem.refresh(sessionId);
  },
};
```

## Next Steps

- [OpenAPI Integration](./openapi) - Document auth endpoints
- [Testing](./testing) - Test middleware and auth flows
