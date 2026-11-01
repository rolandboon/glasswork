# Changelog

All notable changes to Glasswork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
[CONTRIBUTING.md](CONTRIBUTING.md) describes how changes are classified.

## [Unreleased]

### Added

- `InvalidSessionError` and `AuthenticationUnavailableException` exports from `glasswork/auth`, distinguishing invalid tokens from unavailable session validation.
- `detectEnvironment()` export from `glasswork/core`, returning the environment `bootstrap()` uses when no `environment` option is given.
- `dispose` option for singleton and scoped class and factory providers. Transient disposers are rejected because Awilix does not track transient instances. It runs once per resolved instance when `stop()` disposes the container or when a request or job scope ends; an async factory's disposer receives the resolved value.
- `async: true` for factory providers that return a promise without being declared `async`, such as transpiled or bundled factories. Bootstrap awaits them like native async factories.
- `module` option for `providerOverrides`, which replaces a provider in one module only (given as the module or its name), for example when several modules declare a private provider with the same name. An override without `module` that matches several modules logs a warning, and the `ProviderOverride` type is exported from `glasswork/core`.
- Optional `flush(timeoutMs)` and `close(timeoutMs)` on `ExceptionTracker`, implemented by the CloudWatch tracker, and `flushExceptionTracker()` in `glasswork/observability`, which never throws and reports `{ completed, pending }`. `stop()` flushes the configured tracker after the destroy hooks, within `exceptionTracking.flushTimeoutMs` (default 2000 ms).

### Changed

- **Breaking:** a route handler's `session` is no longer typed as non-null just because the route is not `public`. `public` is OpenAPI metadata and does not authenticate requests. The session is non-null when `authorize` is set without `allowGuest: true`, because those requests get a 401 before the handler runs; otherwise it keeps the type of the context variables. Routes protected by auth middleware can declare that with an `AuthenticatedAuthContext` as the second `createRoutes` type argument, or check the session in the handler. `RouteAuthorization` and `RequiresAuthentication` are exported from `glasswork/http`.
- A route handler's `user` is typed as non-null where its `session` is: behind `authorize` without `allowGuest: true`. Handlers no longer need to cast the user there.

### Fixed

- `isProduction()` uses the same detection as `bootstrap()`, so AWS Lambda with `NODE_ENV=test` is no longer production.
- A status set with `context.status()` is kept when the route declares a schema for it, instead of being replaced by the first schema that accepts the data (for example 201 becoming 200 when both share a schema). Data that fails the schema of the explicit status follows the response validation policy. Without an explicit status, or when the explicit status has no schema, the first matching schema still decides.
- Route response validation follows the environment resolved by `bootstrap()` instead of reading `NODE_ENV`. An explicit `environment: 'production'`, or AWS Lambda without `NODE_ENV`, now rejects a response that matches no declared schema with a 500 instead of returning the unvalidated data, and hides serialization error messages. An explicit `environment: 'development'` keeps the lenient behavior even when `NODE_ENV=production`.
- Concurrent `start()` calls resolve only after every `onModuleInit` hook has finished, instead of returning immediately while the first call is still initializing. A failed start keeps rejecting with its original error instead of resolving on the next call, concurrent `stop()` calls share one completion, and `stop()` waits for a pending start. Calling `start()` after `stop()` now rejects.
- `stop()` no longer creates singleton providers that were never used just to run their `onModuleDestroy` hook. Destroy hooks run for singletons that were resolved and for value providers.
- Lifecycle hooks all run to completion before `start()` or `stop()` rejects, so one failing `onModuleDestroy` hook no longer leaves the others unawaited. Several failures are reported together in an `AggregateError`; a single failure is rethrown unchanged.
- `stop()` disposes the container after the `onModuleDestroy` hooks, so Awilix disposers of resolved registrations run when the application stops instead of only on an explicit `container.dispose()`. Disposers also run when a destroy hook failed; stop waits for all disposers and reports multiple failures together. Value providers are never disposed.
- A failed `bootstrap()` (async factory, route setup or automatic start) runs destroy hooks and disposers for the providers it already created before rejecting, instead of leaving them open without a way to call `stop()`.
- A singleton factory that returns a promise without being declared `async` or marked `async: true` now fails on resolution with an error naming its module and provider, instead of injecting the pending promise into its consumers (including async factories that `inject` it). Mark such factories with `async: true`.
- Bootstrap no longer enumerates the container cradle for a debug log. That made Awilix rebuild its registration list once per provider, so bootstrap time grew quadratically with the number of providers, also with debug logging off.
- Reading a service from a route factory's `services` no longer rebuilds the container's registration list. Each read cost time proportional to the number of providers (about 4.8 ms per request with 300 modules); it is now constant.
- Async factory initialization, provider overrides, `start()`/`stop()` and a module container's `registrations` read the container registrations once instead of once per provider. With 300 modules of five providers, bootstrap went from about 0.8 s to 10 ms and `start()` from about 1.1 s to 1 ms.
- The auth middleware no longer treats a provider error during session validation as an invalid session. It answers 503 with an `AuthenticationUnavailableException` (the provider error is its `cause`), keeps the session cookie and skips `onInvalidSession`, instead of clearing the cookie and continuing as a guest. Providers return `null`, or throw the new `InvalidSessionError`, for tokens that are not a valid session.
- The Better Auth provider rethrows Better Auth failures from `validateSession()` and `refreshSession()` instead of returning `null`. It still returns `null` when there is no session or Better Auth rejects the token with a 401 error.
- `MockQueueDriver` with `executeImmediately` runs a job declared in a module's `jobs` in a new scope of that module, like the worker. With module boundaries, a local job could not resolve private providers of its own module when the driver was built in a separate jobs module (`Provider "…" is not available in module "jobs"`).
- `JobService` rejects a payload whose JSON form no longer matches the job schema, such as a `Date` for `v.date()` or a required `undefined` property, with an `InvalidJobPayloadError` at enqueue time. The worker rejected these messages on every attempt. `MockQueueDriver` runs jobs with the JSON form of the payload, so local handlers receive what the worker receives (for example a date string instead of a `Date` for jobs without a schema). Tests that relied on non-JSON payloads locally need JSON values, such as ISO strings with a transform.
- A job defined with typed services, `defineJob<typeof Schema, Services>()`, can be listed in a module's `jobs` and passed to `JobService`, which typed both for `Record<string, unknown>` services only. `EnqueueableJob` is the job type the enqueue methods accept.
- Optional dependencies loaded on demand (`@aws-sdk/client-ssm`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-cloudwatch`, `dotenv` and `@hono/swagger-ui`) also work when an ESM bundle includes them. A bundler can expose a bundled CommonJS package only as `default`, so `ssmProvider` failed with "SSMClient is not a constructor" unless the application redirected the import to the ESM build.
- Importing `glasswork/jobs` or `glasswork/email` no longer requires `@aws-sdk/client-sqs`, `@aws-sdk/client-scheduler` or `@aws-sdk/client-sesv2`. The SQS, Scheduler and SES adapters load their client on first use and name the package to install when it is missing.

## [1.5.0] - 2026-10-31

### Changed

- **Breaking:** enforce module DI boundaries in providers, HTTP routes, and worker jobs. The bootstrap container now exposes root-module providers and imported exports only. Existing applications must declare their imports and exports explicitly; see the module migration guide.
- Reject duplicate module names, duplicate local providers, ambiguous imported exports, and unknown provider overrides. Local providers take precedence over imports.
- `container.register()` can no longer replace an imported provider; use `providerOverrides` instead.

### Added

- Module re-exports via `exports: [ImportedModule]`.
- `forwardRef()` for explicit circular module imports, with documented lazy provider resolution using Awilix's cradle.
- Dependency-ordered async factory initialization via `inject`, with cycle detection.
- `htmlToText` export from `glasswork/email` for the plain-text part of an HTML email.

### Fixed

- Run application lifecycle hooks only for singleton and value providers, without creating request-scoped or transient instances.
- Plain-text email parts no longer contain Outlook conditional-comment remnants (such as `96`), the title, styles or hidden preheader text, and `<link>` tags are no longer turned into list bullets. Links keep their target, a link around an image uses its alt text, entities are decoded once (including numeric ones) and lines are trimmed. Compiled templates and `EmailService.sendRaw` produce the same text.

## [1.4.1] - 2026-10-27

### Fixed

- Clear invalid `__Secure-` and `__Host-` prefixed session cookies with the `Secure` attribute instead of failing the request with a 500 (Better Auth uses the `__Secure-` prefix behind HTTPS).

## [1.4.0] - 2026-10-06

### Added

- Explicit per-send context and application metadata for email delivery hooks.
- Injectable observability policies for runtime diagnostics.
- Native S3 client and command options, object inspection, and conditional upload finalization.
- Native presigner options to bind upload URLs to required request headers.
- Version-aware upload inspection, finalization, and deletion, with optional source retention and native copy results.
- **`glasswork/uploads/guardduty`** — an optional adapter that reads GuardDuty scan tags while preserving AWS statuses, object versions, and the original S3 response.
- Typed job services and a shared validated job lifecycle.
- Provider overrides and bounded OpenAPI contract generation.
- **`glasswork/list-query/client`** — a browser-safe codec for sharing list-query state through URLs.

## [1.3.0] - 2026-10-03

### Added

- Automatic per-attempt CloudWatch EMF metrics for `bootstrapWorker` in Lambda, with configurable namespaces, stable dimensions, opt-out and a synchronous test sink. Metrics use raw stdout without an AWS SDK dependency, omit payloads and error details, and never change job acknowledgements when emission fails. Dashboards and CloudWatch queries remain application-owned; the jobs documentation includes native CDK and Logs Insights examples.

### Changed

- Use TypeScript CDK examples as the primary deployment documentation, while retaining alternative deployment options in the Lambda deployment guide.

### Fixed

- Stop FIFO batches after the first failure and report all unprocessed records for retry.
- Infer separate job input/output types and pass schema output to worker and mock handlers; transport original validated input to avoid chained transforms.
- Reject unsupported driver delays without recursion.

### Removed

- Remove the unused DynamoDB scheduler and its public exports in favor of EventBridge Scheduler.

## [1.2.0] - 2026-09-29

### Added

- **`glasswork/sse`** — in-process server-sent event notifications for long-running Node.js deployments, with bounded connection buffers, heartbeats, and automatic cleanup. The broadcaster does not provide cross-instance delivery or work with the standard Lambda handler.

### Fixed

- Load the optional Swagger UI peer on the first UI request so minimal core consumers can import and bootstrap without it.

- Enable partial batch responses in every SQS worker deployment example so failed jobs remain retryable.

- Preserve SES webhook error responses and return a retryable status when event processing fails.

- Secure the Better Auth role example with `input: false` and document the migration check for existing authorization data.
- Enforce `allowGuest: false` for every unauthenticated request, including routes without an authorization rule, while still clearing invalid session cookies.
- Resolve `SCOPED` route services from an isolated Awilix child container for each HTTP request and dispose the scope after handling.
- Preserve trusted list-query scopes in every facet aggregation, including scopes on the aggregated field and nested logical conditions.
- Verify SNS webhook signatures in every environment by default and restrict automatic subscription confirmation to bounded, non-redirecting AWS SNS requests.
- Require an explicit SNS topic allowlist for verified webhooks and support AWS SNS signature versions 1 and 2.
- Revoke Better Auth sessions with the authenticated session token and use Better Auth's standard cookie name by default.
- Consume rate-limit capacity atomically, require complete DynamoDB configuration, and resolve client IPs from Lambda and Node adapter context.
- HTML-escape email template variables by default, restrict dynamic URL schemes, and require triple braces for trusted raw HTML.
- Encode raw SES messages from UTF-8 bytes and reject header or attachment metadata that could alter the MIME structure.
- Export OpenAPI documents directly after route registration without mounting a temporary public endpoint or using a timer.

## [1.1.0] - 2026-09-16

### Added

- **`glasswork/rls`** — PostgreSQL tenant isolation through Prisma Client Extensions, AsyncLocalStorage, Hono middleware, and a policy generator; includes transaction-scoped context, explicit bypass, and PostgreSQL integration tests.

- **`parseFilterLiteral`**, **`parseFilterValue`**, **`parseWhereFilterValues`** — centralized filter value parsing for query params and Prisma `where` clauses
- **`filter-value-schemas`** — Valibot operand schemas with transforms for typed Prisma filters
- **`executePrismaList`** — direct execution of `findMany`, `count`, and optional `groupBy` aggregations on any Prisma model delegate, with optional `map` row-transformation callback
- **`createPrismaListExecutor` row mapping** — added optional `map: (item: TItem) => TResult` callback to transform raw Prisma records into domain models or DTOs
- **Virtual filter mapping (`mapFilters`)** — transform virtual/composite API filter fields into real database columns prior to search and scope merging; includes `mapPresenceFilter`, `mapBooleanFilter`, `mapValueFilter`, `renameFilter`, `nestFilter`, and `composeFilterMappers`
- **Sort mapping (`mapSorts`)** — transform public API sort fields to nested relation paths (`'user.name'`) or custom sort clauses via `nestSort`, `renameSort`, or custom mapper functions in `createListQuery`
- **`glasswork/audit`** — impersonation-aware auditing subsystem with ambient actor and tenant resolution, pluggable `AuditSink<TTx>` transactional sinks, and dual-logging

### Changed

- Build and typecheck with stable TypeScript 7.0.2; verify published declarations and route inference with TypeScript 5.9, 6, and 7 in isolated npm consumers.
- Propagate concrete authentication types through route contexts.
- Update development dependencies, including Biome 2.5, AWS SDK clients, Hono, CASL, MJML, and documentation tooling. Keep Prisma on stable 7.10 and Vitest on the latest 4.x release compatible with Better Auth's testing peer range.
- Add Node.js 26 to the CI test matrix alongside Node.js 20, 22, and 24; check packed-package imports and types on Node.js 20.
- Make `ListQuerySchema` strict and bounded; malformed pagination, oversized strings, and unknown query parameters now return 422 instead of being clamped or ignored.
- Reject unknown list-query filter fields, filter operators, and sort fields; validate date operands as existing calendar dates.
- Typed filter schemas (`dateFilterSchema`, `intFilterSchema`, `numberFilterSchema`, `booleanFilterSchema`) parse string operands to Prisma types via Valibot transforms
- `parseWhereFilterValues` reuses those schemas with `parse()` instead of custom coercion logic
- List-query `where` deep copy uses `structuredClone` so parsed `Date` values are preserved

### Fixed

- Correctly escape end and else control flow markers in compiled email templates.

## [1.0.0] - 2026-06-10

Major release: subpath exports, dependency upgrades (CASL 7, MJML 5, Valibot 1.4, Prisma 7), Prisma list-query helpers, and internal refactors. Breaking changes when upgrading from 0.x.

### Added

- **Subpath exports:** `glasswork/core`, `glasswork/http`, `glasswork/auth`, `glasswork/list-query`, `glasswork/jobs`, `glasswork/email`, `glasswork/uploads`, `glasswork/observability`
- **`registerAuthCasl({ createPrismaAbility })`** — register the app's Prisma ability factory at startup (same pattern as `registerCasl()` in list-query)
- **`RouteBinder`** and `core/route-factory.ts` — typed route-factory contract
- **`createPrismaListExecutor`**, **`bindPrismaListDelegate`**, **`runGroupByAggregations`**, **`resolveOrderBy`** — Prisma list-query execution helpers
- **`defaultOrderBy`** on `createListQuery` config — applied when the request omits `sorts`
- **`InferListParams`** — infer typed list params from filter/sort Valibot schemas
- **`intFilterSchema`** and **`unrestrictedWhereSchema`** — additional list-query schema helpers
- **`createSortSchema`** dot-notation — nested relation sorts (e.g. `'organization.name'`)
- Shared test helpers under `test/helpers/` (`createTestRouter`, `buildSqsEvent`, `cradleOf`)
- Pack consumer smoke test (`smoke:pack`) wired into `verify`

### Changed

- **Root entry (`glasswork`)** re-exports **core + http only**; optional subsystems require explicit subpaths
- **Peer dependencies** tightened to tested ranges (`valibot` ^1.4, `@prisma/client` ^7, `@casl/ability` ^7, `@casl/prisma` ^2, and others — see `package.json`)
- **MJML 5** — template compilation is async; `compileTemplates()` API updated accordingly
- **CASL 7 / `@casl/prisma` 2** — `PureAbility` replaced by `Ability` / `AnyAbility`; use `accessibleBy().ofType()` for list-query scopes
- **Prisma CASL extension** — `createCaslExtension()` on `PrismaService` for consumer apps
- **Bootstrap internals** — module graph and lifecycle extracted from `bootstrap.ts`; jobs worker no longer imports bootstrap
- **HTTP internals** — `route-helpers.ts` split into focused modules; public `route()` / `createRoutes()` API unchanged
- **API reference docs** — labeled as manually curated (not TypeDoc-generated)
- **CI coverage job** — build `dist/` before coverage; limit coverage to TypeScript sources

### Removed

- **`html-to-text`** dependency (email plain-text generation uses a lighter path)
- Monolithic optional exports from the root `glasswork` barrel
- Redundant direct `standard-openapi` / `standard-json` dependencies (provided via `hono-openapi`)

### Migration from 0.x

1. Replace root imports with subpaths (see [Package Exports](https://glasswork.dev/getting-started/package-exports)):
   - `defineModule`, `bootstrap`, `createConfig` → `glasswork/core`
   - `createRoutes`, `route`, `*Exception` → `glasswork/http`
   - Auth, jobs, email, uploads, list-query, observability → respective subpaths
2. At application startup:
   ```typescript
   import { accessibleBy, createPrismaAbility } from '@casl/prisma';
   import { registerAuthCasl } from 'glasswork/auth';
   import { registerCasl } from 'glasswork/list-query';

   registerCasl({ accessibleBy });
   registerAuthCasl({ createPrismaAbility });
   ```
3. Upgrade CASL/MJML/Valibot/Prisma peers to the ranges in `package.json`
4. Rebuild (`pnpm build`) after install — the package ships compiled `dist/`

## [0.13.3] - 2026-05-28

Last 0.x release before the 1.0 breaking changes. Earlier 0.x history is available on [GitHub releases](https://github.com/rolandboon/glasswork/releases).

[Unreleased]: https://github.com/rolandboon/glasswork/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/rolandboon/glasswork/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/rolandboon/glasswork/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/rolandboon/glasswork/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/rolandboon/glasswork/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/rolandboon/glasswork/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rolandboon/glasswork/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rolandboon/glasswork/compare/v0.13.3...v1.0.0
[0.13.3]: https://github.com/rolandboon/glasswork/compare/v0.13.2...v0.13.3
