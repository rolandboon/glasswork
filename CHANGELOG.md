# Changelog

All notable changes to Glasswork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Stop FIFO batches after the first failure and report all unprocessed records for retry.
- Infer separate job input/output types and pass schema output to worker and mock handlers; transport original validated input to avoid chained transforms.
- Reject unsupported driver delays without recursion. Remove the legacy DynamoDB scheduler and its public exports in favor of EventBridge Scheduler.
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
- **`executePrismaList`** — direct execution of `findMany`, `count`, and optional `groupBy` aggregations on any Prisma model delegate, with optional `map` row-transformation callback
- **`createPrismaListExecutor` row mapping** — added optional `map: (item: TItem) => TResult` callback to transform raw Prisma records into domain models or DTOs
- **Virtual filter mapping (`mapFilters`)** — transform virtual/composite API filter fields into real database columns prior to search and scope merging; includes `mapPresenceFilter`, `mapBooleanFilter`, `mapValueFilter`, `renameFilter`, `nestFilter`, and `composeFilterMappers`
- **Sort mapping (`mapSorts`)** — transform public API sort fields to nested relation paths (`'user.name'`) or custom sort clauses via `nestSort`, `renameSort`, or custom mapper functions in `createListQuery`
- **`glasswork/audit`** — impersonation-aware auditing subsystem with ambient actor and tenant resolution, pluggable `AuditSink<TTx>` transactional sinks, and dual-logging

### Changed

- Build and typecheck with stable TypeScript 7.0.2; verify published declarations and route inference with TypeScript 5.9, 6, and 7 in isolated npm consumers.
- Update development dependencies, including Biome 2.5, AWS SDK clients, Hono, CASL, MJML, and documentation tooling. Keep Prisma on stable 7.10 and Vitest on the latest 4.x release compatible with Better Auth's testing peer range.
- Add Node.js 26 to the CI test matrix alongside Node.js 20, 22, and 24; check packed-package imports and types on Node.js 20.
- Make `ListQuerySchema` strict and bounded; malformed pagination, oversized strings, and unknown query parameters now return 422 instead of being clamped or ignored.
- Reject unknown list-query filter fields, filter operators, and sort fields; validate date operands as existing calendar dates.
- Infer list-query parameters from their validation schema.
- Preserve concrete authentication types in route contexts.

### Fixed

- Escape template literals in email compiler `end` and `else` control-flow markers.

### Removed

- **`bindPrismaListDelegate`** — use `executePrismaList` with a Prisma model delegate instead.

## [1.0.1] - 2026-06-10

### Added

- **`parseFilterLiteral`**, **`parseFilterValue`**, **`parseWhereFilterValues`** — centralized filter value parsing for query params and Prisma `where` clauses
- **`filter-value-schemas`** — Valibot operand schemas with transforms for typed Prisma filters

### Changed

- Typed filter schemas (`dateFilterSchema`, `intFilterSchema`, `numberFilterSchema`, `booleanFilterSchema`) parse string operands to Prisma types via Valibot transforms
- `parseWhereFilterValues` reuses those schemas with `parse()` instead of custom coercion logic
- List-query `where` deep copy uses `structuredClone` so parsed `Date` values are preserved

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

[Unreleased]: https://github.com/rolandboon/glasswork/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rolandboon/glasswork/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/rolandboon/glasswork/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rolandboon/glasswork/compare/v0.13.3...v1.0.0
[0.13.3]: https://github.com/rolandboon/glasswork/compare/v0.13.2...v0.13.3
