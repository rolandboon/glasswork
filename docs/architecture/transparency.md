---
description: The transparency principle — how Glasswork provides direct access to underlying libraries without heavy abstractions.
---

# The Transparency Principle

## Enhance, Don't Replace

Glasswork follows a core principle: **expose underlying libraries directly, never hide them behind heavy abstractions**.

Glasswork uses Hono, Awilix and Prisma directly. Its helpers add conventions and sometimes constrain an API; those differences and the native alternatives are described below. This means:

- ✅ Native Hono APIs remain available
- ✅ Library documentation and examples remain useful, subject to the helper contracts below
- ✅ AI assistants can help you better
- ✅ No vendor lock-in
- ✅ Lower learning curve

## The Problem with Heavy Abstractions

Many frameworks wrap popular libraries with custom DSLs:

```typescript
// ❌ BAD: Framework hides the HTTP library
@Controller('/users')
export class UserController {
  @Get()
  getUsers() {
    // What HTTP framework is this? Can I use middleware?
    // How do I access request headers?
    // The underlying library's docs don't help
  }
}
```

**Problems with this approach:**

1. Can't use Stack Overflow answers for the underlying library
2. Advanced features become inaccessible
3. Library documentation becomes useless
4. Framework lock-in, can't migrate away easily
5. Have to learn both the library AND the framework's version of it

## Our Approach: Transparent Wrappers

### Real Hono Instances

```typescript
// ✅ GOOD: You get a real Hono instance
export const userRoutes = createRoutes((router, services, route) => {
  // router is type: Hono - all features available

  // Use any Hono middleware
  router.use(cors());
  router.use('*', logger());

  // Use any Hono method
  router.get('/health', (c) => c.text('OK'));

  // Plus our optional helpers
  router.post('/users', ...route({
    body: CreateUserDto,
    handler: ({ body }) => services.userService.create(body),
  }));
});
```

**Result:** You can copy-paste from Hono documentation directly.

### Real Awilix Containers, Seen Through Module Boundaries

```typescript
// ✅ GOOD: Direct Awilix access
const { app, container } = await bootstrap(AppModule);

// Register a provider in the root module
container.register({
  userService: asClass(UserService)
    .singleton()
    .disposer((service) => service.cleanup()), // Full Awilix API
});

const scope = container.createScope();
await container.dispose();
```

Providers live in a real Awilix container. The `container` that `bootstrap()` returns is a view on it for the root module: a proxy that translates provider names to module-qualified registrations and only shows what the root module can see. It supports the Awilix API you use day to day, with these differences:

| Awilix feature | Through the module view |
| --- | --- |
| `resolve`, `cradle`, `hasRegistration`, `getRegistration` | The root module's own providers and the exports of the modules it imports |
| `register` | Adds or replaces providers of the root module. Registering an imported name throws; use `providerOverrides` |
| `registrations` | The registrations the root module can see, under their plain names |
| `createScope` | A scope with the same module view; dispose it as usual |
| `build` | Resolves dependencies through the same module view |
| `dispose`, lifetimes, disposers, `asClass`/`asFunction`/`asValue` | Native Awilix behavior |

Private providers of other modules are not reachable through `resolve` or `cradle` on this view. These visibility rules organize dependencies; they are not a security boundary. To work with a feature module directly, bootstrap that module.

`stop()` disposes the container after running `onModuleDestroy` hooks, so registered disposers run when the application stops.

Glasswork creates and disposes an Awilix child scope for every module-route
request. Route factories receive lazy proxies for `SCOPED` providers so a
service destructured during bootstrap resolves against the request that later
uses it. Manual container access outside HTTP still follows the ordinary Awilix
scope API shown above.

### Prisma Extensions and RLS

[Row Level Security](/auth/row-level-security) uses Prisma's public `$extends`
and transaction APIs. Model delegates, query arguments, result types, and database
errors remain Prisma's. Policies are ordinary SQL in reviewed migrations; the
generator does not run migrations or create a second query language.

There is a concrete limitation to the transparency promise here: the optional RLS
extension replaces `$transaction` with a callback-only contract. Array transactions
are rejected because individual queries already receive their own transaction.
RLS must also be the last extension applied. These restrictions mean the extended
client does not preserve every Prisma feature unchanged.

For applications that need the full native transaction API, keep transaction setup
in an infrastructure adapter using the unextended client and transaction-local
PostgreSQL settings. The same policies continue to apply. See
[Using Prisma Directly](/auth/row-level-security#using-prisma-directly) for the exit
path and [Writes and Transactions](/auth/row-level-security#writes-and-transactions)
for the extension's exact contract.

## Four Promises per Helper

For each Glasswork helper on top of a library, the documentation should make four contracts explicit:

1. **What it adds or changes**: validation, scopes, transactions, defaults or error handling.
2. **Native types, results and errors stay intact** where possible, and the documentation says where they do not.
3. **The native client or adapter is reachable**, and it is clear who owns its lifecycle.
4. **You can skip the helper**: an example shows the native way, including which guarantees your code then provides itself. A raw Hono `Response`, for example, is sent unchanged and skips response validation; an unextended Prisma client keeps the full transaction API, but your code must bind tenant context for RLS.

## Real-World Benefits

### 1. Stack Overflow Works

```typescript
// Question: "How do I add CORS to Hono?"
// Answer from Stack Overflow:
import { cors } from 'hono/cors';
app.use(cors());

// ✅ This works in Glasswork because we expose real Hono
createRoutes((router, services, route) => {
  router.use(cors()); // Just works!
});
```

### 2. AI Assistants Work Better

AI assistants trained on Hono and Awilix can help you directly. No need to translate between framework-specific concepts.

### 3. Library Updates Work Immediately

```typescript
// Hono releases a new feature: streaming responses

// ✅ Immediately available in Glasswork
router.get('/stream', (c) => {
  return c.stream(/* new Hono feature */);
});

// ❌ With heavy abstraction: wait for framework update
```

## Framework as a Detail

This transparency principle aligns with our broader philosophy: **the framework is a detail at the edges of your application**.

Your business logic never imports the framework. Your routes are thin adapters. And when you need to drop down to the underlying library, it's right there, no fighting the framework.

::: tip Learn More
Read the full [Architecture Philosophy](/architecture/philosophy) to understand how this principle enables clean, maintainable code.
:::

## Success Metrics

We maintain transparency by ensuring:

1. ✅ Developers can use underlying library docs directly
2. ✅ Library documentation and examples remain useful, subject to the helper contracts below
3. ✅ Library features remain accessible, and the docs name each place where a helper limits one, such as RLS transactions or the module-scoped container
4. ✅ Developers can drop the framework and keep the libraries
5. ✅ Learning curve is about conventions, not new APIs
