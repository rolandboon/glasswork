# The Transparency Principle

## Enhance, Don't Replace

Glasswork follows a core principle: **expose underlying libraries directly, never hide them behind heavy abstractions**.

When you use Hono, Awilix, or Prisma in Glasswork, you get the real thing, not a wrapper. This means:

- ✅ All Hono documentation applies directly
- ✅ Stack Overflow answers work without modification
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

### Real Awilix Containers

```typescript
// ✅ GOOD: Direct Awilix access
const { app, container } = bootstrap(AppModule);

// Use any Awilix feature
container.register({
  userService: asClass(UserService)
    .singleton()
    .disposer((service) => service.cleanup()), // Full Awilix API
});

const scope = container.createScope();
await container.dispose();
```

The `container` is a real Awilix container. You have full access to scopes, disposers, and build-time resolution.

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
2. ✅ Stack Overflow answers work without modification
3. ✅ ALL library features remain accessible
4. ✅ Developers can drop the framework and keep the libraries
5. ✅ Learning curve is about conventions, not new APIs
